from django.conf import settings
from django.contrib import admin
from django.db.models import F
from django.db.models.functions import Coalesce
from django.utils.translation import gettext_lazy as _
from unfold.admin import ModelAdmin

from apps.catalog.models import Product

from .models import InventoryMovement, Stock


def default_low_stock_threshold() -> int:
    return getattr(settings, "LOW_STOCK_THRESHOLD_DEFAULT", 5)


def effective_low_stock_threshold(product: Product) -> int:
    """Seuil d'un produit donné : le sien s'il en a un, sinon le défaut."""
    if product.low_stock_threshold is not None:
        return product.low_stock_threshold
    return default_low_stock_threshold()


class StockStatusFilter(admin.SimpleListFilter):
    title = _("état du stock")
    parameter_name = "stock_status"

    def lookups(self, request, model_admin):
        return (
            ("low", _("Stock faible")),
            ("out", _("Rupture")),
        )

    def queryset(self, request, queryset):
        if self.value() == "low":
            return queryset.annotate(
                effective_threshold=Coalesce(
                    "product__low_stock_threshold", default_low_stock_threshold()
                )
            ).filter(quantity__gt=0, quantity__lte=F("effective_threshold"))
        if self.value() == "out":
            return queryset.filter(quantity__lte=0)
        return queryset


@admin.register(Stock)
class StockAdmin(ModelAdmin):
    list_display = ("product", "store", "quantity", "status_label", "updated_at")
    list_filter = ("store", StockStatusFilter)
    list_select_related = ("product", "store")
    search_fields = ("product__name", "product__barcode", "store__name")
    readonly_fields = ("id", "store", "product", "quantity", "updated_at")
    autocomplete_fields = ("store", "product")

    @admin.display(description=_("état"))
    def status_label(self, obj: Stock) -> str:
        if obj.quantity <= 0:
            return _("Rupture")
        if obj.quantity <= effective_low_stock_threshold(obj.product):
            return _("Faible")
        return "OK"

    def has_add_permission(self, request) -> bool:
        return False

    def has_change_permission(self, request, obj=None) -> bool:
        return False

    def has_delete_permission(self, request, obj=None) -> bool:
        return False


@admin.register(InventoryMovement)
class InventoryMovementAdmin(ModelAdmin):
    list_display = (
        "created_at",
        "movement_type",
        "store",
        "product",
        "quantity",
        "reference",
    )
    list_filter = ("movement_type", "store")
    search_fields = ("product__name", "product__barcode", "reference")
    readonly_fields = (
        "id",
        "store",
        "product",
        "movement_type",
        "quantity",
        "reference",
        "created_at",
    )

    def has_add_permission(self, request) -> bool:
        return False

    def has_change_permission(self, request, obj=None) -> bool:
        return False

    def has_delete_permission(self, request, obj=None) -> bool:
        return False
