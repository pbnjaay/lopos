from django.contrib import admin
from unfold.admin import ModelAdmin

from .models import CashRegister, Store


@admin.register(Store)
class StoreAdmin(ModelAdmin):
    list_display = ("name", "is_active", "created_at", "updated_at")
    list_filter = ("is_active",)
    search_fields = ("name", "address")
    readonly_fields = ("id", "created_at", "updated_at")


@admin.register(CashRegister)
class CashRegisterAdmin(ModelAdmin):
    list_display = ("name", "store", "is_active", "created_at")
    list_filter = ("is_active", "store")
    search_fields = ("name", "store__name")
    readonly_fields = ("id", "created_at", "updated_at")
    autocomplete_fields = ("store",)
