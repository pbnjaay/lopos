import uuid
from decimal import Decimal

from django.conf import settings
from django.db import models
from django.db.models import F, Q
from django.db.models.functions import Round
from django.utils import timezone

from apps.cash.models import CashSession
from apps.catalog.models import Product


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
    status = models.CharField("statut", max_length=10, choices=Status.choices)
    created_at = models.DateTimeField("créée le", auto_now_add=True)
    occurred_at = models.DateTimeField(
        "réalisée le",
        default=timezone.now,
        help_text=(
            "Moment réel de la vente sur la caisse. Identique à created_at pour une "
            "vente en ligne ; peut être antérieur pour une vente synchronisée depuis "
            "le mode hors-ligne."
        ),
    )

    class Meta:
        ordering = ("-created_at",)
        verbose_name = "vente"
        verbose_name_plural = "ventes"
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
        ]

    def __str__(self) -> str:
        return f"Vente {self.id} — {self.total}"


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
    unit_price = models.DecimalField("prix unitaire", max_digits=14, decimal_places=2)
    quantity = models.DecimalField("quantité", max_digits=12, decimal_places=3)
    line_total = models.DecimalField("total de la ligne", max_digits=14, decimal_places=2)

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
        ]

    def __str__(self) -> str:
        return f"{self.product_name} × {self.quantity}"

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
    sale = models.OneToOneField(
        Sale,
        on_delete=models.PROTECT,
        related_name="payment",
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
        return f"{self.method} — {self.amount}"


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
    total_refund = models.DecimalField("total remboursé", max_digits=14, decimal_places=2)
    payment_method = models.CharField(
        "mode de remboursement", max_length=16, choices=Payment.Method.choices
    )
    status = models.CharField("statut", max_length=10, choices=Status.choices, default=Status.COMPLETED)
    idempotency_key = models.UUIDField("clé d’idempotence", unique=True)
    created_at = models.DateTimeField("créé le", auto_now_add=True)

    class Meta:
        ordering = ("-created_at",)
        verbose_name = "retour"
        verbose_name_plural = "retours"
        constraints = [
            models.CheckConstraint(condition=Q(total_refund__gt=0), name="sales_return_total_positive")
        ]

    def save(self, *args, **kwargs):
        if not self.reference:
            self.reference = f"RET-{str(self.id).split('-')[0].upper()}"
        super().save(*args, **kwargs)

    def __str__(self) -> str:
        return self.reference


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
