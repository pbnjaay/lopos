from django.contrib import admin
from unfold.admin import ModelAdmin

from .models import CashSession


@admin.register(CashSession)
class CashSessionAdmin(ModelAdmin):
    list_display = (
        "opened_at",
        "cash_register",
        "cashier",
        "opening_balance",
        "status",
        "expected_balance",
        "closing_balance",
        "difference",
        "closed_at",
    )
    list_filter = ("status", "cash_register__store", "cash_register", "cashier", "opened_at")
    search_fields = (
        "cash_register__name",
        "cash_register__store__name",
        "cashier__username",
    )
    date_hierarchy = "opened_at"
    readonly_fields = (
        "id",
        "cash_register",
        "cashier",
        "opening_balance",
        "status",
        "opened_at",
        "closing_balance",
        "expected_balance",
        "difference",
        "closed_at",
    )

    def has_add_permission(self, request) -> bool:
        return False

    def has_change_permission(self, request, obj=None) -> bool:
        return False

    def has_delete_permission(self, request, obj=None) -> bool:
        return False
