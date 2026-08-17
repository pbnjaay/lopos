from django.contrib import admin

from .models import Product


@admin.register(Product)
class ProductAdmin(admin.ModelAdmin):
    list_display = ("name", "barcode", "selling_price", "is_active", "updated_at")
    list_filter = ("is_active",)
    search_fields = ("name", "barcode")
    readonly_fields = ("id", "created_at", "updated_at")
