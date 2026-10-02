from django.contrib import admin
from unfold.admin import ModelAdmin

from apps.tenancy.admin_mixins import TenantAdminMixin

from .models import ProcessedSyncEvent


@admin.register(ProcessedSyncEvent)
class ProcessedSyncEventAdmin(TenantAdminMixin, ModelAdmin):
    list_display = (
        "processed_at",
        "event_id",
        "terminal_id",
        "event_type",
        "entity_id",
        "pushed_by",
        "stock_discrepancy",
        "catalog_price_discrepancy",
    )
    list_filter = ("event_type", "stock_discrepancy", "catalog_price_discrepancy", "terminal_id")
    search_fields = ("event_id", "entity_id", "terminal_id")
    date_hierarchy = "processed_at"

    def has_add_permission(self, request) -> bool:
        return False

    def has_change_permission(self, request, obj=None) -> bool:
        return False

    def has_delete_permission(self, request, obj=None) -> bool:
        return False
