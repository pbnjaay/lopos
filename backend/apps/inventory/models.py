import uuid

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
    )
    product = models.ForeignKey(
        Product,
        on_delete=models.PROTECT,
        related_name="stocks",
    )
    quantity = models.IntegerField(default=0)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("store_id", "product_id")
        constraints = [
            models.UniqueConstraint(
                fields=("store", "product"),
                name="inventory_unique_stock_per_store_product",
            ),
            models.CheckConstraint(
                condition=Q(quantity__gte=0),
                name="inventory_stock_quantity_nonnegative",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.store} — {self.product}: {self.quantity}"


class InventoryMovement(models.Model):
    class Type(models.TextChoices):
        STOCK_IN = "STOCK_IN", "Entrée de stock"
        SALE = "SALE", "Vente"
        ADJUSTMENT = "ADJUSTMENT", "Ajustement"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    store = models.ForeignKey(
        Store,
        on_delete=models.PROTECT,
        related_name="inventory_movements",
    )
    product = models.ForeignKey(
        Product,
        on_delete=models.PROTECT,
        related_name="inventory_movements",
    )
    movement_type = models.CharField(max_length=16, choices=Type.choices)
    quantity = models.IntegerField()
    reference = models.UUIDField(blank=True, null=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-created_at",)
        constraints = [
            models.CheckConstraint(
                condition=~Q(quantity=0),
                name="inventory_movement_quantity_nonzero",
            )
        ]

    def __str__(self) -> str:
        return f"{self.movement_type} {self.quantity:+d} — {self.product}"
