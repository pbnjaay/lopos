import uuid
from decimal import Decimal

from django.db import models
from django.db.models import Q


class Product(models.Model):
    class SaleUnit(models.TextChoices):
        UNIT = "UNIT", "Unité"
        KG = "KG", "Kilogramme"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField("nom", max_length=255)
    barcode = models.CharField("code-barres", max_length=64, blank=True, null=True)
    selling_price = models.DecimalField("prix de vente", max_digits=14, decimal_places=2)
    purchase_price = models.DecimalField(
        "prix d'achat",
        max_digits=14,
        decimal_places=2,
        blank=True,
        null=True,
    )
    sale_unit = models.CharField(
        "unité de vente", max_length=8, choices=SaleUnit.choices, default=SaleUnit.UNIT
    )
    is_active = models.BooleanField("actif", default=True)
    created_at = models.DateTimeField("créé le", auto_now_add=True)
    updated_at = models.DateTimeField("modifié le", auto_now=True)

    class Meta:
        ordering = ("name",)
        verbose_name = "produit"
        verbose_name_plural = "produits"
        constraints = [
            models.CheckConstraint(
                condition=Q(selling_price__gte=Decimal("0")),
                name="catalog_product_selling_price_nonnegative",
            ),
            models.CheckConstraint(
                condition=Q(purchase_price__isnull=True)
                | Q(purchase_price__gte=Decimal("0")),
                name="catalog_product_purchase_price_nonnegative",
            ),
            models.UniqueConstraint(
                fields=("barcode",),
                condition=Q(barcode__isnull=False),
                name="catalog_unique_product_barcode_when_set",
            ),
        ]

    def __str__(self) -> str:
        return self.name
