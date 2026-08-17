from django.contrib import admin

from .models import InventoryMovement, Stock


@admin.register(Stock)
class StockAdmin(admin.ModelAdmin):
    list_display = ("store", "product", "quantity", "updated_at")
    list_filter = ("store",)
    search_fields = ("product__name", "product__barcode", "store__name")
    readonly_fields = ("id", "updated_at")
    autocomplete_fields = ("store", "product")


@admin.register(InventoryMovement)
class InventoryMovementAdmin(admin.ModelAdmin):
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
