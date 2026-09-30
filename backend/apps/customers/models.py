import uuid
from decimal import Decimal

from django.conf import settings
from django.db import models
from django.db.models import F, Q
from django.utils import timezone

from apps.cash.models import CashSession
from apps.sales.models import Payment
from apps.stores.models import Store

from .exceptions import ImmutableLedgerEntry


class Customer(models.Model):
    """Client d'un magasin, titulaire d'un cahier.

    Aucun solde stocké ici : le solde est toujours la somme des écritures de
    `CustomerLedgerEntry` (voir `apps.customers.services.customer_balance`).
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    store = models.ForeignKey(
        Store,
        on_delete=models.PROTECT,
        related_name="customers",
        verbose_name="magasin",
    )
    name = models.CharField("nom", max_length=255)
    phone = models.CharField(
        "téléphone",
        max_length=16,
        blank=True,
        null=True,
        help_text=(
            "Numéro international, ex. +221 77 123 45 67. Obligatoire pour un "
            "client créé depuis la caisse."
        ),
    )
    notes = models.TextField("notes", blank=True, default="")
    is_active = models.BooleanField("actif", default=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="customers_created",
        verbose_name="créé par",
        blank=True,
        null=True,
    )
    created_at = models.DateTimeField("créé le", auto_now_add=True)
    updated_at = models.DateTimeField("modifié le", auto_now=True)

    class Meta:
        ordering = ("name",)
        verbose_name = "client"
        verbose_name_plural = "clients"
        constraints = [
            models.UniqueConstraint(
                fields=("store", "phone"),
                condition=Q(phone__isnull=False),
                name="customers_unique_phone_per_store",
                violation_error_message="Un client existe déjà avec ce numéro dans ce magasin.",
            ),
            models.CheckConstraint(
                condition=~Q(name=""),
                name="customers_customer_name_not_empty",
            ),
            models.CheckConstraint(
                condition=Q(phone__isnull=True) | Q(phone__startswith="+"),
                name="customers_customer_phone_normalized",
            ),
        ]
        indexes = [
            models.Index(fields=("store", "name"), name="customers_store_name_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.name} ({self.phone})" if self.phone else self.name


class CustomerPayment(models.Model):
    """Argent reçu d'un client pour réduire son cahier.

    Porte ce que l'écriture du cahier ne doit pas porter : le moyen de
    paiement, la session de caisse où l'argent est entré, la monnaie rendue,
    l'idempotence et un instantané du solde pour le reçu. Chaque paiement a
    exactement une écriture PAYMENT (`ledger_entry`), créée dans la même
    transaction.

    Ce n'est pas une vente : il entre dans les espèces attendues de la session
    mais jamais dans le chiffre d'affaires.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    reference = models.CharField("référence", max_length=16, unique=True, editable=False)
    customer = models.ForeignKey(
        Customer, on_delete=models.PROTECT, related_name="payments", verbose_name="client"
    )
    store = models.ForeignKey(
        Store, on_delete=models.PROTECT, related_name="customer_payments", verbose_name="magasin"
    )
    cash_session = models.ForeignKey(
        CashSession,
        on_delete=models.PROTECT,
        related_name="customer_payments",
        verbose_name="session de caisse",
    )
    method = models.CharField("mode de paiement", max_length=16, choices=Payment.Method.choices)
    amount = models.DecimalField("montant", max_digits=14, decimal_places=2)
    received_amount = models.DecimalField(
        "montant reçu", max_digits=14, decimal_places=2, blank=True, null=True
    )
    change_amount = models.DecimalField(
        "monnaie rendue", max_digits=14, decimal_places=2, blank=True, null=True
    )
    balance_before = models.DecimalField("ancien solde", max_digits=14, decimal_places=2)
    balance_after = models.DecimalField("nouveau solde", max_digits=14, decimal_places=2)
    idempotency_key = models.UUIDField("clé d’idempotence", unique=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="customer_payments",
        verbose_name="encaissé par",
    )
    created_at = models.DateTimeField("encaissé le", default=timezone.now)

    class Meta:
        ordering = ("-created_at",)
        verbose_name = "paiement client"
        verbose_name_plural = "paiements clients"
        constraints = [
            models.CheckConstraint(
                condition=Q(amount__gt=Decimal("0")),
                name="customers_payment_amount_positive",
            ),
            # Pas de trop-perçu : un paiement ne dépasse jamais le solde dû.
            models.CheckConstraint(
                condition=Q(balance_after=F("balance_before") - F("amount"))
                & Q(balance_after__gte=Decimal("0")),
                name="customers_payment_balance_snapshot_consistent",
            ),
            # Même règle que les paiements de vente (sales_payment_details_match_method).
            models.CheckConstraint(
                condition=(
                    Q(
                        method="CASH",
                        received_amount__isnull=False,
                        change_amount__isnull=False,
                        received_amount__gte=F("amount"),
                        change_amount=F("received_amount") - F("amount"),
                    )
                    | Q(
                        method__in=("WAVE", "ORANGE_MONEY"),
                        received_amount__isnull=True,
                        change_amount__isnull=True,
                    )
                ),
                name="customers_payment_details_match_method",
            ),
        ]
        indexes = [
            models.Index(fields=("cash_session", "method"), name="customers_payment_session_idx"),
        ]

    def save(self, *args, **kwargs):
        if not self.reference:
            self.reference = f"RMB-{str(self.id).split('-')[0].upper()}"
        super().save(*args, **kwargs)

    def __str__(self) -> str:
        return self.reference


class CustomerLedgerEntryQuerySet(models.QuerySet):
    def update(self, **kwargs):
        raise ImmutableLedgerEntry("Une écriture du cahier ne peut pas être modifiée.")

    def delete(self):
        raise ImmutableLedgerEntry("Une écriture du cahier ne peut pas être supprimée.")


class CustomerLedgerEntry(models.Model):
    """Écriture immuable du cahier d'un client.

    Convention de signe unique : `amount > 0` = le client doit plus,
    `amount < 0` = le client doit moins. Le solde est `SUM(amount)`.

    Une écriture n'est jamais modifiée ni supprimée : on la corrige par une
    nouvelle écriture (`ADJUSTMENT`) ou on l'annule par un `REVERSAL` qui la
    référence. Chaque type impose son signe et ses références via une
    contrainte PostgreSQL.
    """

    class EntryType(models.TextChoices):
        CREDIT_SALE = "CREDIT_SALE", "Achat à crédit"
        PAYMENT = "PAYMENT", "Paiement"
        RETURN_CREDIT = "RETURN_CREDIT", "Retour déduit du cahier"
        ADJUSTMENT = "ADJUSTMENT", "Ajustement"
        OPENING_BALANCE = "OPENING_BALANCE", "Solde d’ouverture"
        REVERSAL = "REVERSAL", "Annulation d’écriture"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    customer = models.ForeignKey(
        Customer,
        on_delete=models.PROTECT,
        related_name="ledger_entries",
        verbose_name="client",
    )
    store = models.ForeignKey(
        Store,
        on_delete=models.PROTECT,
        related_name="customer_ledger_entries",
        verbose_name="magasin",
    )
    entry_type = models.CharField("type", max_length=16, choices=EntryType.choices)
    amount = models.DecimalField("montant", max_digits=14, decimal_places=2)
    sale = models.ForeignKey(
        "sales.Sale",
        on_delete=models.PROTECT,
        related_name="customer_ledger_entries",
        verbose_name="vente",
        blank=True,
        null=True,
    )
    sale_return = models.ForeignKey(
        "sales.SaleReturn",
        on_delete=models.PROTECT,
        related_name="customer_ledger_entries",
        verbose_name="retour",
        blank=True,
        null=True,
    )
    customer_payment = models.OneToOneField(
        CustomerPayment,
        on_delete=models.PROTECT,
        related_name="ledger_entry",
        verbose_name="paiement client",
        blank=True,
        null=True,
    )
    reversal_of = models.OneToOneField(
        "self",
        on_delete=models.PROTECT,
        related_name="reversed_by",
        verbose_name="annule l’écriture",
        blank=True,
        null=True,
    )
    reference = models.CharField(
        "référence",
        max_length=64,
        blank=True,
        default="",
        help_text="Référence externe libre, ex. « ACCESS:1234 » pour une reprise.",
    )
    reason = models.TextField("motif", blank=True, default="")
    occurred_at = models.DateTimeField("date", default=timezone.now)
    created_at = models.DateTimeField("créée le", auto_now_add=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="customer_ledger_entries",
        verbose_name="créée par",
        blank=True,
        null=True,
    )

    objects = CustomerLedgerEntryQuerySet.as_manager()

    class Meta:
        ordering = ("-occurred_at", "-created_at")
        verbose_name = "écriture du cahier"
        verbose_name_plural = "écritures du cahier"
        constraints = [
            models.CheckConstraint(
                condition=~Q(amount=Decimal("0")),
                name="customers_entry_amount_nonzero",
                violation_error_message="Le montant ne peut pas être nul.",
            ),
            # Une écriture PAYMENT naît toujours d'un CustomerPayment, et
            # c'est la seule qui puisse en référencer un.
            models.CheckConstraint(
                condition=Q(entry_type="PAYMENT", customer_payment__isnull=False)
                | (~Q(entry_type="PAYMENT") & Q(customer_payment__isnull=True)),
                name="customers_entry_payment_link",
            ),
            # Signe et références imposés par type.
            models.CheckConstraint(
                condition=(
                    Q(
                        entry_type="CREDIT_SALE",
                        amount__gt=0,
                        sale__isnull=False,
                        sale_return__isnull=True,
                        reversal_of__isnull=True,
                    )
                    | Q(
                        entry_type="PAYMENT",
                        amount__lt=0,
                        sale__isnull=True,
                        sale_return__isnull=True,
                        reversal_of__isnull=True,
                    )
                    | Q(
                        entry_type="RETURN_CREDIT",
                        amount__lt=0,
                        sale__isnull=False,
                        sale_return__isnull=False,
                        reversal_of__isnull=True,
                    )
                    | (
                        Q(
                            entry_type="ADJUSTMENT",
                            sale__isnull=True,
                            sale_return__isnull=True,
                            reversal_of__isnull=True,
                        )
                        & ~Q(reason="")
                    )
                    | Q(
                        entry_type="OPENING_BALANCE",
                        amount__gt=0,
                        sale__isnull=True,
                        sale_return__isnull=True,
                        reversal_of__isnull=True,
                    )
                    | (
                        Q(
                            entry_type="REVERSAL",
                            sale__isnull=True,
                            sale_return__isnull=True,
                            reversal_of__isnull=False,
                        )
                        & ~Q(reason="")
                    )
                ),
                name="customers_entry_type_rules",
            ),
            models.UniqueConstraint(
                fields=("sale",),
                condition=Q(entry_type="CREDIT_SALE"),
                name="customers_one_credit_entry_per_sale",
            ),
            models.UniqueConstraint(
                fields=("sale_return",),
                condition=Q(entry_type="RETURN_CREDIT"),
                name="customers_one_credit_entry_per_return",
            ),
            models.UniqueConstraint(
                fields=("customer",),
                condition=Q(entry_type="OPENING_BALANCE"),
                name="customers_one_opening_balance_per_customer",
                violation_error_message="Ce client a déjà un solde d’ouverture.",
            ),
        ]
        indexes = [
            models.Index(
                fields=("customer", "occurred_at"), name="customers_entry_customer_idx"
            ),
            models.Index(fields=("store", "occurred_at"), name="customers_entry_store_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.get_entry_type_display()} {self.amount:+}"

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise ImmutableLedgerEntry("Une écriture du cahier ne peut pas être modifiée.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ImmutableLedgerEntry("Une écriture du cahier ne peut pas être supprimée.")
