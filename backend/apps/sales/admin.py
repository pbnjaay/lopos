from django.contrib import admin
from unfold.admin import ModelAdmin, TabularInline

from .models import Payment, Sale, SaleItem


class ReadOnlySalesAdmin(ModelAdmin):
    def has_add_permission(self, request) -> bool:
        return False

    def has_change_permission(self, request, obj=None) -> bool:
        return False

    def has_delete_permission(self, request, obj=None) -> bool:
        return False


class ReadOnlyTabularInline(TabularInline):
    extra = 0
    can_delete = False

    def has_add_permission(self, request, obj=None) -> bool:
        return False

    def has_change_permission(self, request, obj=None) -> bool:
        return False

    def has_delete_permission(self, request, obj=None) -> bool:
        return False


class SaleItemInline(ReadOnlyTabularInline):
    model = SaleItem
    fields = ("product_name", "unit_price", "quantity", "line_total")
    verbose_name = "article vendu"
    verbose_name_plural = "articles vendus"


class PaymentInline(ReadOnlyTabularInline):
    model = Payment
    fields = ("method", "amount", "received_amount", "change_amount")
    max_num = 1
    verbose_name = "paiement"
    verbose_name_plural = "paiement"


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
    inlines = (SaleItemInline, PaymentInline)


@admin.register(SaleItem)
class SaleItemAdmin(ReadOnlySalesAdmin):
    list_display = ("sale", "product_name", "unit_price", "quantity", "line_total")
    search_fields = ("sale__id", "product_name", "product__barcode")


@admin.register(Payment)
class PaymentAdmin(ReadOnlySalesAdmin):
    list_display = ("created_at", "sale", "method", "amount", "change_amount")
    list_filter = ("method",)
    search_fields = ("sale__id",)
