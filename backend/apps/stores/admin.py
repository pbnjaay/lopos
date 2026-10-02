from django.contrib import admin
from django.db.models import Count, Q, QuerySet
from django.utils.translation import gettext_lazy as _
from unfold.admin import ModelAdmin

from apps.tenancy.admin_mixins import TenantAdminMixin, is_platform_admin
from apps.tenancy.context import get_tenant

from .models import CashRegister, Store, StoreAssignment


@admin.register(Store)
class StoreAdmin(TenantAdminMixin, ModelAdmin):
    list_display = (
        "name",
        "is_active",
        "cash_register_count",
        "stocked_product_count",
    )
    list_filter = ("is_active",)
    # Explicite : l'annotation des compteurs fait perdre le tri du modèle.
    ordering = ("name",)
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

    def get_list_display(self, request):
        list_display = super().get_list_display(request)
        if is_platform_admin(request):
            return ("name", "organization", *list_display[1:])
        return list_display

    def get_list_filter(self, request):
        list_filter = super().get_list_filter(request)
        if is_platform_admin(request):
            return (*list_filter, "organization")
        return list_filter

    def get_fieldsets(self, request, obj=None):
        fieldsets = super().get_fieldsets(request, obj)
        if not is_platform_admin(request):
            return fieldsets
        (title, options), *rest = fieldsets
        return ((title, {**options, "fields": ("organization", *options["fields"])}), *rest)

    def get_readonly_fields(self, request, obj=None):
        # Changer le commerce d'un magasin y emporterait toutes ses données.
        if obj is not None:
            return (*self.readonly_fields, "organization")
        return self.readonly_fields

    def get_form(self, request, obj=None, **kwargs):
        form = super().get_form(request, obj, **kwargs)
        # Plateforme : un magasin appartient toujours à un commerce.
        if "organization" in form.base_fields:
            form.base_fields["organization"].required = True
        return form

    def save_model(self, request, obj: Store, form, change: bool) -> None:
        # Un commerce ne crée de magasin que chez lui, jamais ailleurs.
        if not change and not is_platform_admin(request):
            obj.organization = get_tenant(request).organization
        super().save_model(request, obj, form, change)

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
class CashRegisterAdmin(TenantAdminMixin, ModelAdmin):
    list_display = ("name", "store", "is_active", "created_at")
    list_filter = ("is_active", "store")
    search_fields = ("name", "store__name")
    readonly_fields = ("id", "created_at", "updated_at")
    autocomplete_fields = ("store",)

    def get_readonly_fields(self, request, obj=None):
        # Déplacer une caisse emporterait ses sessions et ses ventes dans un
        # autre magasin : le magasin est figé une fois la caisse créée.
        if obj is not None:
            return (*self.readonly_fields, "store")
        return self.readonly_fields


@admin.register(StoreAssignment)
class StoreAssignmentAdmin(TenantAdminMixin, ModelAdmin):
    list_display = ("user", "store", "is_active", "created_at")
    list_filter = ("is_active", "store")
    search_fields = ("user__username", "user__first_name", "user__last_name", "store__name")
    autocomplete_fields = ("user", "store")
    readonly_fields = ("created_at", "updated_at")
