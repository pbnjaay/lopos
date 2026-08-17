from django.contrib import admin

from .models import Payment, Sale, SaleItem


class ReadOnlySalesAdmin(admin.ModelAdmin):
    def has_add_permission(self, request) -> bool:
        return False

    def has_change_permission(self, request, obj=None) -> bool:
        return False

    def has_delete_permission(self, request, obj=None) -> bool:
        return False


@admin.register(Sale)
class SaleAdmin(ReadOnlySalesAdmin):
    list_display = (
        "created_at",
        "id",
        "cash_session",
        "cashier",
        "total",
        "status",
    )
    list_filter = ("status", "cash_session__cash_register__store")
    search_fields = ("id", "cashier__username")


@admin.register(SaleItem)
class SaleItemAdmin(ReadOnlySalesAdmin):
    list_display = ("sale", "product_name", "unit_price", "quantity", "line_total")
    search_fields = ("sale__id", "product_name", "product__barcode")


@admin.register(Payment)
class PaymentAdmin(ReadOnlySalesAdmin):
    list_display = ("created_at", "sale", "method", "amount", "change_amount")
    list_filter = ("method",)
    search_fields = ("sale__id",)
