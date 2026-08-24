import uuid
from decimal import Decimal

from django.db import models
from django.db.models import Q

from apps.catalog.models import Product
from apps.stores.models import Store


class Stock(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    store = models.ForeignKey(
        Store,
        on_delete=models.PROTECT,
        related_name="stocks",
        verbose_name="magasin",
    )
    product = models.ForeignKey(
        Product,
        on_delete=models.PROTECT,
        related_name="stocks",
        verbose_name="produit",
    )
    quantity = models.DecimalField("quantité", max_digits=12, decimal_places=3, default=Decimal("0"))
    updated_at = models.DateTimeField("modifié le", auto_now=True)

    class Meta:
        ordering = ("store_id", "product_id")
        verbose_name = "stock"
        verbose_name_plural = "stocks"
        constraints = [
            models.UniqueConstraint(
                fields=("store", "product"),
                name="inventory_unique_stock_per_store_product",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.store} — {self.product}: {self.quantity}"


class InventoryMovement(models.Model):
    class Type(models.TextChoices):
        STOCK_IN = "STOCK_IN", "Entrée de stock"
        SALE = "SALE", "Vente"
        ADJUSTMENT = "ADJUSTMENT", "Ajustement"
        RETURN_IN = "RETURN_IN", "Retour remis en stock"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    store = models.ForeignKey(
        Store,
        on_delete=models.PROTECT,
        related_name="inventory_movements",
        verbose_name="magasin",
    )
    product = models.ForeignKey(
        Product,
        on_delete=models.PROTECT,
        related_name="inventory_movements",
        verbose_name="produit",
    )
    movement_type = models.CharField(
        "type de mouvement", max_length=16, choices=Type.choices
    )
    quantity = models.DecimalField("quantité", max_digits=12, decimal_places=3)
    reference = models.UUIDField("référence", blank=True, null=True, db_index=True)
    created_at = models.DateTimeField("créé le", auto_now_add=True)

    class Meta:
        ordering = ("-created_at",)
        verbose_name = "mouvement de stock"
        verbose_name_plural = "mouvements de stock"
        constraints = [
            models.CheckConstraint(
                condition=~Q(quantity=0),
                name="inventory_movement_quantity_nonzero",
            )
        ]

    def __str__(self) -> str:
        return f"{self.movement_type} {self.quantity:+} — {self.product}"
