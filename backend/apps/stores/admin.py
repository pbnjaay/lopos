from django.contrib import admin
from django.db.models import Count, Q, QuerySet
from django.utils.translation import gettext_lazy as _
from unfold.admin import ModelAdmin

from .models import CashRegister, Store, StoreAssignment


@admin.register(Store)
class StoreAdmin(ModelAdmin):
    list_display = (
        "name",
        "is_active",
        "cash_register_count",
        "stocked_product_count",
    )
    list_filter = ("is_active",)
    search_fields = ("name", "address")
    readonly_fields = (
        "id",
        "created_at",
        "updated_at",
        "cash_register_count",
        "stocked_product_count",
    )
    fieldsets = (
        (None, {"fields": ("id", "name", "address", "is_active")}),
        (
            _("Aperçu"),
            {"fields": ("cash_register_count", "stocked_product_count")},
        ),
        (
            _("Métadonnées"),
            {"fields": ("created_at", "updated_at"), "classes": ("collapse",)},
        ),
    )

    def get_queryset(self, request) -> QuerySet[Store]:
        return (
            super()
            .get_queryset(request)
            .annotate(
                _cash_register_count=Count("cash_registers", distinct=True),
                _stocked_product_count=Count(
                    "stocks", filter=Q(stocks__quantity__gt=0), distinct=True
                ),
            )
        )

    @admin.display(description=_("caisses"), ordering="_cash_register_count")
    def cash_register_count(self, obj: Store) -> int:
        return obj._cash_register_count

    @admin.display(description=_("produits en stock"), ordering="_stocked_product_count")
    def stocked_product_count(self, obj: Store) -> int:
        return obj._stocked_product_count


@admin.register(CashRegister)
class CashRegisterAdmin(ModelAdmin):
    list_display = ("name", "store", "is_active", "created_at")
    list_filter = ("is_active", "store")
    search_fields = ("name", "store__name")
    readonly_fields = ("id", "created_at", "updated_at")
    autocomplete_fields = ("store",)


@admin.register(StoreAssignment)
class StoreAssignmentAdmin(ModelAdmin):
    list_display = ("user", "store", "is_active", "created_at")
    list_filter = ("is_active", "store")
    search_fields = ("user__username", "user__first_name", "user__last_name", "store__name")
    autocomplete_fields = ("user", "store")
    readonly_fields = ("created_at", "updated_at")
