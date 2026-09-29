import uuid
from decimal import Decimal

from django.conf import settings
from django.db import models
from django.db.models import Q
from django.utils import timezone

from apps.cash.models import CashSession
from apps.sales.models import Payment
from apps.stores.models import Store

from .exceptions import ImmutableExpense


class ExpenseCategory(models.Model):
    """Nature d'une dépense (« Électricité », « Transport »…), commune à
    toutes les boutiques. Se désactive, ne se supprime jamais : des dépenses
    y restent rattachées."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField("nom", max_length=64, unique=True)
    requires_description = models.BooleanField(
        "description obligatoire",
        default=False,
        help_text="La catégorie seule ne dit pas ce qui a été payé (ex. « Autre »).",
    )
    is_active = models.BooleanField("active", default=True)
    sort_order = models.PositiveSmallIntegerField("ordre d’affichage", default=0)
    created_at = models.DateTimeField("créée le", auto_now_add=True)
    updated_at = models.DateTimeField("modifiée le", auto_now=True)

    class Meta:
        ordering = ("sort_order", "name")
        verbose_name = "catégorie de dépense"
        verbose_name_plural = "catégories de dépenses"
        constraints = [
            models.CheckConstraint(
                condition=~Q(name=""),
                name="expenses_category_name_not_empty",
            ),
        ]

    def __str__(self) -> str:
        return self.name


class ExpenseQuerySet(models.QuerySet):
    def update(self, **kwargs):
        raise ImmutableExpense("Une dépense ne peut pas être modifiée : annulez-la.")

    def delete(self):
        raise ImmutableExpense("Une dépense ne peut pas être supprimée : annulez-la.")


class Expense(models.Model):
    """Argent sorti pour faire tourner la boutique.

    Ni une vente négative, ni une écriture du cahier, ni un mouvement de
    stock. La nature (`category`) est distincte du moyen de règlement
    (`payment_method`) : seules les dépenses en espèces diminuent les espèces
    attendues de leur session.

    Une dépense validée ne se modifie jamais. On la corrige en l'annulant
    (`status=CANCELLED`, avec qui, quand, pourquoi), puis en saisissant la
    bonne ; une dépense annulée ne compte plus dans aucun total.
    """

    class Status(models.TextChoices):
        POSTED = "POSTED", "Enregistrée"
        CANCELLED = "CANCELLED", "Annulée"

    CANCELLATION_FIELDS = frozenset(
        {"status", "cancelled_at", "cancelled_by", "cancellation_reason"}
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    reference = models.CharField("référence", max_length=16, unique=True, editable=False)
    store = models.ForeignKey(
        Store, on_delete=models.PROTECT, related_name="expenses", verbose_name="magasin"
    )
    cash_session = models.ForeignKey(
        CashSession,
        on_delete=models.PROTECT,
        related_name="expenses",
        verbose_name="session de caisse",
        blank=True,
        null=True,
        help_text="Obligatoire pour une dépense en espèces : l'argent sort d'un tiroir.",
    )
    category = models.ForeignKey(
        ExpenseCategory,
        on_delete=models.PROTECT,
        related_name="expenses",
        verbose_name="catégorie",
    )
    amount = models.DecimalField("montant", max_digits=14, decimal_places=2)
    payment_method = models.CharField(
        "mode de paiement", max_length=16, choices=Payment.Method.choices
    )
    description = models.TextField("description", blank=True, default="")
    document_reference = models.CharField(
        "référence du justificatif",
        max_length=64,
        blank=True,
        default="",
        help_text="Numéro de facture ou de transaction, ex. « SENELEC-… ».",
    )
    status = models.CharField(
        "statut", max_length=16, choices=Status.choices, default=Status.POSTED
    )
    occurred_at = models.DateTimeField("date", default=timezone.now)
    idempotency_key = models.UUIDField("clé d’idempotence", unique=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="expenses",
        verbose_name="saisie par",
    )
    created_at = models.DateTimeField("saisie le", default=timezone.now)
    cancelled_at = models.DateTimeField("annulée le", blank=True, null=True)
    cancelled_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="expenses_cancelled",
        verbose_name="annulée par",
        blank=True,
        null=True,
    )
    cancellation_reason = models.TextField("motif d’annulation", blank=True, default="")

    objects = ExpenseQuerySet.as_manager()

    class Meta:
        ordering = ("-occurred_at", "-created_at")
        verbose_name = "dépense"
        verbose_name_plural = "dépenses"
        permissions = (("cancel_expense", "Peut annuler une dépense"),)
        constraints = [
            models.CheckConstraint(
                condition=Q(amount__gt=Decimal("0")),
                name="expenses_amount_positive",
            ),
            models.CheckConstraint(
                condition=Q(payment_method__in=("CASH", "WAVE", "ORANGE_MONEY")),
                name="expenses_payment_method_valid",
            ),
            models.CheckConstraint(
                condition=Q(status__in=("POSTED", "CANCELLED")),
                name="expenses_status_valid",
            ),
            # Des espèces sortent toujours d'un tiroir, donc d'une session.
            models.CheckConstraint(
                condition=~Q(payment_method="CASH") | Q(cash_session__isnull=False),
                name="expenses_cash_requires_session",
            ),
            # Une annulation dit toujours qui, quand et pourquoi — et une
            # dépense enregistrée n'en porte aucune trace.
            models.CheckConstraint(
                condition=(
                    Q(
                        status="POSTED",
                        cancelled_at__isnull=True,
                        cancelled_by__isnull=True,
                        cancellation_reason="",
                    )
                    | (
                        Q(
                            status="CANCELLED",
                            cancelled_at__isnull=False,
                            cancelled_by__isnull=False,
                        )
                        & ~Q(cancellation_reason="")
                    )
                ),
                name="expenses_cancellation_consistent",
            ),
        ]
        indexes = [
            models.Index(
                fields=("cash_session", "payment_method", "status"),
                name="expenses_session_idx",
            ),
            models.Index(fields=("store", "occurred_at"), name="expenses_store_date_idx"),
        ]

    def __str__(self) -> str:
        return self.reference

    def save(self, *args, **kwargs):
        # Seule modification admise : l'annulation, faite par le service
        # (`cancel_expense`) sous verrou, champ par champ.
        if not self._state.adding:
            update_fields = kwargs.get("update_fields")
            if update_fields is None or not set(update_fields) <= self.CANCELLATION_FIELDS:
                raise ImmutableExpense("Une dépense ne peut pas être modifiée : annulez-la.")
        if not self.reference:
            self.reference = f"DEP-{str(self.id).split('-')[0].upper()}"
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ImmutableExpense("Une dépense ne peut pas être supprimée : annulez-la.")
