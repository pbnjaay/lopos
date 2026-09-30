import uuid
from decimal import Decimal

from django.conf import settings
from django.db import models
from django.db.models import Q
from django.utils import timezone

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
    average_unit_cost = models.DecimalField(
        "coût moyen",
        max_digits=14,
        decimal_places=4,
        blank=True,
        null=True,
        help_text=(
            "Coût d'achat moyen pondéré d'une unité dans ce magasin. Vide quand "
            "il n'est pas connu — jamais 0 par défaut, ce qui gonflerait la "
            "marge. Ne se modifie que par une réception ou une initialisation "
            "tracée, jamais à la main."
        ),
    )
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
            models.CheckConstraint(
                condition=Q(average_unit_cost__isnull=True)
                | Q(average_unit_cost__gte=Decimal("0")),
                name="inventory_stock_average_cost_nonnegative",
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
        # Distinct de RETURN_IN : ici la vente est annulée dans la foulée,
        # aucune marchandise n'est physiquement rapportée par un client.
        CANCELLATION = "CANCELLATION", "Vente annulée"

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
    unit_cost = models.DecimalField(
        "coût unitaire",
        max_digits=14,
        decimal_places=4,
        blank=True,
        null=True,
        help_text=(
            "Coût d'une unité appliqué à ce mouvement : prix d'achat pour une "
            "entrée, coût moyen du moment pour une sortie. Vide si inconnu."
        ),
    )
    reference = models.UUIDField("référence", blank=True, null=True, db_index=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="inventory_movements",
        verbose_name="créé par",
        blank=True,
        null=True,
    )
    created_at = models.DateTimeField("créé le", auto_now_add=True)

    class Meta:
        ordering = ("-created_at",)
        verbose_name = "mouvement de stock"
        verbose_name_plural = "mouvements de stock"
        constraints = [
            models.CheckConstraint(
                condition=~Q(quantity=0),
                name="inventory_movement_quantity_nonzero",
            ),
            models.CheckConstraint(
                condition=Q(unit_cost__isnull=True) | Q(unit_cost__gte=Decimal("0")),
                name="inventory_movement_unit_cost_nonnegative",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.movement_type} {self.quantity:+} — {self.product}"


class StockValuation(Stock):
    """Le stock vu par sa valeur : même table, écran et permissions à part —
    le coût d'achat et les marges ne sont pas pour tout le monde."""

    class Meta:
        proxy = True
        verbose_name = "valorisation du stock"
        verbose_name_plural = "valorisation du stock"
        permissions = (("set_cost_stockvaluation", "Peut définir le coût d'un stock"),)


class StockCostChange(models.Model):
    """Journal immuable des changements de coût moyen hors réception.

    Une réception recalcule le coût moyen et le trace dans son mouvement ;
    tout le reste — initialisation d'un coût inconnu, correction, import —
    passe par une ligne ici, sans faux mouvement de stock : la quantité ne
    bouge pas, seule la valeur du stock change.
    """

    class Source(models.TextChoices):
        INITIAL = "INITIAL", "Initialisation"
        CORRECTION = "CORRECTION", "Correction"
        IMPORT = "IMPORT", "Import"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    store = models.ForeignKey(
        Store,
        on_delete=models.PROTECT,
        related_name="stock_cost_changes",
        verbose_name="magasin",
    )
    product = models.ForeignKey(
        Product,
        on_delete=models.PROTECT,
        related_name="stock_cost_changes",
        verbose_name="produit",
    )
    source = models.CharField("origine", max_length=16, choices=Source.choices)
    previous_cost = models.DecimalField(
        "ancien coût", max_digits=14, decimal_places=4, blank=True, null=True
    )
    new_cost = models.DecimalField("nouveau coût", max_digits=14, decimal_places=4)
    quantity_at_change = models.DecimalField(
        "stock au moment du changement", max_digits=12, decimal_places=3
    )
    reason = models.CharField("motif", max_length=255, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="stock_cost_changes",
        verbose_name="modifié par",
        blank=True,
        null=True,
        help_text="Vide pour un changement fait par le système (migration, import).",
    )
    created_at = models.DateTimeField("le", default=timezone.now)

    class Meta:
        ordering = ("-created_at",)
        verbose_name = "changement de coût"
        verbose_name_plural = "changements de coût"
        constraints = [
            models.CheckConstraint(
                condition=Q(new_cost__gte=Decimal("0")),
                name="inventory_cost_change_new_cost_nonnegative",
            ),
            models.CheckConstraint(
                condition=Q(previous_cost__isnull=True)
                | Q(previous_cost__gte=Decimal("0")),
                name="inventory_cost_change_previous_cost_nonnegative",
            ),
            # Une initialisation part toujours d'un coût inconnu ; changer un
            # coût déjà connu est une correction, qui doit dire pourquoi.
            models.CheckConstraint(
                condition=~Q(source="INITIAL") | Q(previous_cost__isnull=True),
                name="inventory_cost_change_initial_from_unknown",
            ),
            models.CheckConstraint(
                condition=~Q(source="CORRECTION") | ~Q(reason=""),
                name="inventory_cost_change_correction_has_reason",
            ),
        ]
        indexes = [
            models.Index(
                fields=("store", "product", "created_at"),
                name="inventory_cost_change_idx",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.product} — {self.previous_cost} → {self.new_cost}"
