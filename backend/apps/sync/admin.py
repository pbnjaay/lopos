from django.contrib import admin
from unfold.admin import ModelAdmin

from .models import ProcessedSyncEvent


@admin.register(ProcessedSyncEvent)
class ProcessedSyncEventAdmin(ModelAdmin):
    list_display = (
        "processed_at",
        "event_id",
        "terminal_id",
        "event_type",
        "entity_id",
        "stock_discrepancy",
    )
    list_filter = ("event_type", "stock_discrepancy", "terminal_id")
    search_fields = ("event_id", "entity_id", "terminal_id")
    date_hierarchy = "processed_at"

    def has_add_permission(self, request) -> bool:
        return False

    def has_change_permission(self, request, obj=None) -> bool:
        return False

    def has_delete_permission(self, request, obj=None) -> bool:
        return False
