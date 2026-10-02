import uuid
from decimal import Decimal

from django.conf import settings
from django.db import models
from django.db.models import F, Q
from django.db.models.functions import Round
from django.utils import timezone

from apps.cash.models import CashSession
from apps.catalog.models import Product
from apps.dashboard.formatting import format_fcfa, format_quantity


class Sale(models.Model):
    class Status(models.TextChoices):
        COMPLETED = "COMPLETED", "Terminée"
        CANCELLED = "CANCELLED", "Annulée"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    cash_session = models.ForeignKey(
        CashSession,
        on_delete=models.PROTECT,
        related_name="sales",
        verbose_name="session de caisse",
    )
    cashier = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="sales",
        verbose_name="caissier",
    )
    subtotal = models.DecimalField("sous-total", max_digits=14, decimal_places=2)
    discount = models.DecimalField(
        "remise", max_digits=14, decimal_places=2, default=Decimal("0")
    )
    total = models.DecimalField("total", max_digits=14, decimal_places=2)
    customer = models.ForeignKey(
        "customers.Customer",
        on_delete=models.PROTECT,
        related_name="sales",
        verbose_name="client",
        blank=True,
        null=True,
    )
    credit_amount = models.DecimalField(
        "mis au cahier",
        max_digits=14,
        decimal_places=2,
        default=Decimal("0"),
        help_text=(
            "Part du total non encaissée, inscrite au cahier du client : ce "
            "qu'il reste à payer une fois les paiements déduits."
        ),
    )
    status = models.CharField("statut", max_length=10, choices=Status.choices)
    # Remise au-delà de ce qu'un caissier accorde seul : qui l'a validée.
    discount_approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="approved_sale_discounts",
        verbose_name="remise validée par",
        blank=True,
        null=True,
    )
    # Annulation : qui, quand, pourquoi, et qui l'a validée au besoin.
    cancelled_at = models.DateTimeField("annulée le", blank=True, null=True)
    cancelled_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="cancelled_sales",
        verbose_name="annulée par",
        blank=True,
        null=True,
    )
    cancellation_reason = models.CharField("motif d'annulation", max_length=500, blank=True)
    cancellation_approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="approved_sale_cancellations",
        verbose_name="annulation validée par",
        blank=True,
        null=True,
    )
    created_at = models.DateTimeField("créée le", auto_now_add=True)
    occurred_at = models.DateTimeField(
        "réalisée le",
        default=timezone.now,
        help_text=(
            "Heure de la vente sur la caisse. Une vente faite sans connexion garde "
            "son heure réelle, même si elle arrive plus tard au serveur."
        ),
    )

    class Meta:
        ordering = ("-created_at",)
        # Distinct du nom de la section (« Ventes ») : le fil d'Ariane lit
        # « Ventes › Tickets de vente », comme les fiches « Ticket E15F6488 ».
        verbose_name = "ticket de vente"
        verbose_name_plural = "tickets de vente"
        # Coûts d'achat, marges et résultat estimé : pas pour tout le monde.
        permissions = (("view_profitability", "Peut voir la rentabilité"),)
        constraints = [
            models.CheckConstraint(
                condition=Q(status__in=("COMPLETED", "CANCELLED")),
                name="sales_sale_status_valid",
            ),
            models.CheckConstraint(
                condition=Q(subtotal__gte=Decimal("0")),
                name="sales_sale_subtotal_nonnegative",
            ),
            models.CheckConstraint(
                condition=Q(discount__gte=Decimal("0")) & Q(discount__lte=F("subtotal")),
                name="sales_sale_discount_valid",
            ),
            models.CheckConstraint(
                condition=Q(total__gte=Decimal("0"))
                & Q(total=F("subtotal") - F("discount")),
                name="sales_sale_total_consistent",
            ),
            models.CheckConstraint(
                condition=Q(credit_amount__gte=Decimal("0"))
                & Q(credit_amount__lte=F("total")),
                name="sales_sale_credit_amount_valid",
            ),
            models.CheckConstraint(
                condition=Q(credit_amount=Decimal("0")) | Q(customer__isnull=False),
                name="sales_sale_credit_requires_customer",
            ),
        ]
        indexes = [
            # Rapports par période (tableau de bord, rentabilité).
            models.Index(fields=("status", "occurred_at"), name="sales_sale_status_date_idx"),
        ]

    def __str__(self) -> str:
        return f"Ticket {self.reference}"

    @property
    def reference(self) -> str:
        """Référence imprimée sur le ticket du POS : les 8 premiers caractères
        de l'identifiant, en majuscules (« E15F6488 »)."""
        return str(self.id)[:8].upper()


class SaleItem(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    sale = models.ForeignKey(
        Sale,
        on_delete=models.PROTECT,
        related_name="items",
        verbose_name="vente",
    )
    product = models.ForeignKey(
        Product,
        on_delete=models.PROTECT,
        related_name="sale_items",
        verbose_name="produit",
    )
    product_name = models.CharField("nom du produit", max_length=255)
    sale_unit = models.CharField(
        "unité de vente", max_length=8, choices=Product.SaleUnit.choices,
        default=Product.SaleUnit.UNIT,
    )
    catalog_unit_price = models.DecimalField(
        "prix catalogue", max_digits=14, decimal_places=2, default=Decimal("0")
    )
    # Vente hors ligne : `catalog_unit_price` est celui que le poste affichait
    # (le catalogue a pu changer depuis). Le poste n'étant pas une source de
    # confiance, le prix serveur est gardé ici quand il diffère, pour revue.
    server_catalog_unit_price = models.DecimalField(
        "prix catalogue serveur",
        max_digits=14,
        decimal_places=2,
        blank=True,
        null=True,
        help_text=(
            "Vente hors ligne seulement : prix catalogue connu du serveur à la "
            "synchronisation, renseigné quand il diffère du prix catalogue "
            "envoyé par le poste."
        ),
    )
    unit_price = models.DecimalField("prix unitaire", max_digits=14, decimal_places=2)
    quantity = models.DecimalField("quantité", max_digits=12, decimal_places=3)
    line_total = models.DecimalField("total de la ligne", max_digits=14, decimal_places=2)
    unit_cost = models.DecimalField(
        "coût d'achat unitaire",
        max_digits=14,
        decimal_places=4,
        blank=True,
        null=True,
        help_text=(
            "Coût moyen du produit dans le magasin au moment de la vente, figé : "
            "la marge d'une vente passée ne suit jamais le coût actuel. Vide si "
            "le coût n'était pas connu (ventes antérieures au suivi des coûts)."
        ),
    )

    class Meta:
        ordering = ("id",)
        verbose_name = "article vendu"
        verbose_name_plural = "articles vendus"
        constraints = [
            models.CheckConstraint(
                condition=Q(quantity__gt=0),
                name="sales_item_quantity_positive",
            ),
            models.CheckConstraint(
                condition=Q(unit_price__gte=Decimal("0")),
                name="sales_item_unit_price_nonnegative",
            ),
            models.CheckConstraint(
                condition=Q(catalog_unit_price__gte=Decimal("0")),
                name="sales_item_catalog_price_nonnegative",
            ),
            models.CheckConstraint(
                condition=Q(line_total__gte=Decimal("0"))
                & Q(line_total=Round(F("unit_price") * F("quantity"), precision=2)),
                name="sales_item_line_total_consistent",
            ),
            models.CheckConstraint(
                condition=Q(unit_cost__isnull=True) | Q(unit_cost__gte=Decimal("0")),
                name="sales_item_unit_cost_nonnegative",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.product_name} × {format_quantity(self.quantity, self.sale_unit)}"

    @property
    def quantity_returned(self) -> Decimal:
        value = self.return_items.filter(sale_return__status=SaleReturn.Status.COMPLETED).aggregate(
            total=models.Sum("quantity")
        )["total"]
        return value or Decimal("0.000")

    @property
    def quantity_returnable(self) -> Decimal:
        return self.quantity - self.quantity_returned


class Payment(models.Model):
    class Method(models.TextChoices):
        CASH = "CASH", "Espèces"
        WAVE = "WAVE", "Wave"
        ORANGE_MONEY = "ORANGE_MONEY", "Orange Money"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    sale = models.ForeignKey(
        Sale,
        on_delete=models.PROTECT,
        related_name="payments",
        verbose_name="vente",
    )
    method = models.CharField("mode de paiement", max_length=16, choices=Method.choices)
    amount = models.DecimalField("montant", max_digits=14, decimal_places=2)
    received_amount = models.DecimalField(
        "montant reçu",
        max_digits=14,
        decimal_places=2,
        blank=True,
        null=True,
    )
    change_amount = models.DecimalField(
        "monnaie rendue",
        max_digits=14,
        decimal_places=2,
        blank=True,
        null=True,
    )
    created_at = models.DateTimeField("créé le", auto_now_add=True)

    class Meta:
        ordering = ("-created_at",)
        verbose_name = "paiement"
        verbose_name_plural = "paiements"
        constraints = [
            models.CheckConstraint(
                condition=Q(amount__gte=Decimal("0")),
                name="sales_payment_amount_nonnegative",
            ),
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
                name="sales_payment_details_match_method",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.get_method_display()} — {format_fcfa(self.amount)}"


class SaleReturn(models.Model):
    class Status(models.TextChoices):
        COMPLETED = "COMPLETED", "Terminé"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    reference = models.CharField("référence", max_length=16, unique=True, editable=False)
    original_sale = models.ForeignKey(
        Sale, on_delete=models.PROTECT, related_name="returns", verbose_name="vente originale"
    )
    cash_session = models.ForeignKey(
        CashSession, on_delete=models.PROTECT, related_name="sale_returns",
        verbose_name="session de caisse"
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="sale_returns",
        verbose_name="créé par"
    )
    total_refund = models.DecimalField(
        "valeur retournée",
        max_digits=14,
        decimal_places=2,
        help_text=(
            "Valeur des articles rendus. Elle réduit le chiffre d'affaires net ; "
            "l'argent réellement rendu en est la part hors cahier."
        ),
    )
    credit_reduction = models.DecimalField(
        "déduit du cahier",
        max_digits=14,
        decimal_places=2,
        default=Decimal("0"),
        help_text=(
            "Part du retour effacée de la dette du client, sur une vente mise au "
            "cahier. Jamais de l'argent : seul le reste est remboursé."
        ),
    )
    payment_method = models.CharField(
        "mode de remboursement",
        max_length=16,
        choices=Payment.Method.choices,
        blank=True,
        null=True,
        help_text="Vide quand tout le retour a été déduit du cahier (aucun argent rendu).",
    )
    status = models.CharField("statut", max_length=10, choices=Status.choices, default=Status.COMPLETED)
    # Retour au-delà de ce qu'un caissier fait seul : qui l'a validé.
    approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="approved_sale_returns",
        verbose_name="validé par",
        blank=True,
        null=True,
    )
    idempotency_key = models.UUIDField("clé d’idempotence", unique=True)
    created_at = models.DateTimeField("créé le", auto_now_add=True)

    class Meta:
        ordering = ("-created_at",)
        verbose_name = "retour"
        verbose_name_plural = "retours"
        constraints = [
            models.CheckConstraint(condition=Q(total_refund__gt=0), name="sales_return_total_positive"),
            models.CheckConstraint(
                condition=Q(credit_reduction__gte=0) & Q(credit_reduction__lte=F("total_refund")),
                name="sales_return_credit_reduction_valid",
            ),
            # Un moyen de remboursement exactement quand de l'argent est rendu.
            models.CheckConstraint(
                condition=(
                    Q(payment_method__isnull=True, credit_reduction=F("total_refund"))
                    | (Q(payment_method__isnull=False) & Q(credit_reduction__lt=F("total_refund")))
                ),
                name="sales_return_method_iff_money_refund",
            ),
        ]
        indexes = [
            models.Index(fields=("created_at",), name="sales_return_created_idx"),
        ]

    def save(self, *args, **kwargs):
        if not self.reference:
            self.reference = f"RET-{str(self.id).split('-')[0].upper()}"
        super().save(*args, **kwargs)

    def __str__(self) -> str:
        return self.reference

    @property
    def money_refund(self) -> Decimal:
        """Argent réellement rendu au client : la valeur retournée hors cahier."""
        return self.total_refund - self.credit_reduction


class SaleReturnItem(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    sale_return = models.ForeignKey(
        SaleReturn, on_delete=models.PROTECT, related_name="items", verbose_name="retour"
    )
    original_sale_item = models.ForeignKey(
        SaleItem, on_delete=models.PROTECT, related_name="return_items",
        verbose_name="article vendu"
    )
    quantity = models.DecimalField("quantité", max_digits=12, decimal_places=3)
    unit_price = models.DecimalField("prix remboursé", max_digits=14, decimal_places=2)
    refund_amount = models.DecimalField("montant remboursé", max_digits=14, decimal_places=2)
    restock = models.BooleanField("remis en stock", default=True)

    class Meta:
        ordering = ("id",)
        verbose_name = "article retourné"
        verbose_name_plural = "articles retournés"
        constraints = [
            models.CheckConstraint(condition=Q(quantity__gt=0), name="sales_return_item_quantity_positive"),
            models.CheckConstraint(condition=Q(unit_price__gt=0), name="sales_return_item_price_positive"),
            models.CheckConstraint(condition=Q(refund_amount__gt=0), name="sales_return_item_refund_positive"),
        ]
