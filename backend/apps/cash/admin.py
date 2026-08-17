from django.contrib import admin

from .models import CashSession


@admin.register(CashSession)
class CashSessionAdmin(admin.ModelAdmin):
    list_display = (
        "opened_at",
        "cash_register",
        "cashier",
        "opening_balance",
        "status",
        "closed_at",
    )
    list_filter = ("status", "cash_register__store")
    search_fields = (
        "cash_register__name",
        "cash_register__store__name",
        "cashier__username",
    )
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
