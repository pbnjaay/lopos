from django.contrib import admin
from django.db.models import Count, Q, QuerySet
from django.http import HttpRequest
from django.utils.translation import gettext_lazy as _
from unfold.admin import ModelAdmin, TabularInline

from apps.stores.models import Store

from .models import Organization, OrganizationMembership
from .roles import sync_member_access


class PlatformAdminOnlyMixin:
    """Réservé aux super-utilisateurs de la plateforme : un gérant ne voit
    jamais qu'il existe d'autres commerces."""

    def has_module_permission(self, request: HttpRequest) -> bool:
        return request.user.is_active and request.user.is_superuser

    def has_view_permission(self, request: HttpRequest, obj=None) -> bool:
        return request.user.is_active and request.user.is_superuser

    def has_add_permission(self, request: HttpRequest, obj=None) -> bool:
        return request.user.is_active and request.user.is_superuser

    def has_change_permission(self, request: HttpRequest, obj=None) -> bool:
        return request.user.is_active and request.user.is_superuser

    def has_delete_permission(self, request: HttpRequest, obj=None) -> bool:
        # Une organisation se suspend ; ses données restent.
        return False


class StoreInline(PlatformAdminOnlyMixin, TabularInline):
    model = Store
    fields = ("name", "is_active")
    readonly_fields = fields
    extra = 0
    show_change_link = True
    verbose_name = _("magasin")
    verbose_name_plural = _("magasins")

    def has_add_permission(self, request: HttpRequest, obj=None) -> bool:
        return False

    def has_change_permission(self, request: HttpRequest, obj=None) -> bool:
        return False


class OrganizationMembershipInline(PlatformAdminOnlyMixin, TabularInline):
    model = OrganizationMembership
    fk_name = "organization"
    fields = ("user", "role", "can_view_costs", "is_active")
    autocomplete_fields = ("user",)
    extra = 0


@admin.register(Organization)
class OrganizationAdmin(PlatformAdminOnlyMixin, ModelAdmin):
    list_display = ("name", "slug", "status", "store_count", "member_count")
    list_filter = ("status",)
    search_fields = ("name", "slug")
    prepopulated_fields = {"slug": ("name",)}
    readonly_fields = ("id", "created_at", "updated_at")
    fieldsets = (
        (None, {"fields": ("name", "slug", "status")}),
        (
            _("Métadonnées"),
            {"fields": ("id", "created_at", "updated_at"), "classes": ("collapse",)},
        ),
    )
    inlines = (StoreInline, OrganizationMembershipInline)

    def get_queryset(self, request: HttpRequest) -> QuerySet[Organization]:
        return (
            super()
            .get_queryset(request)
            .annotate(
                _store_count=Count("stores", distinct=True),
                _member_count=Count(
                    "memberships",
                    filter=Q(memberships__is_active=True),
                    distinct=True,
                ),
            )
        )

    @admin.display(description=_("magasins"), ordering="_store_count")
    def store_count(self, obj: Organization) -> int:
        return obj._store_count

    @admin.display(description=_("membres actifs"), ordering="_member_count")
    def member_count(self, obj: Organization) -> int:
        return obj._member_count

    def save_formset(self, request, form, formset, change) -> None:
        memberships = formset.save(commit=False)
        for membership in memberships:
            if isinstance(membership, OrganizationMembership) and membership.pk is None:
                membership.created_by = request.user
            membership.save()
        formset.save_m2m()
        # Rôle nommé ou changé (un propriétaire, typiquement) : ses groupes
        # et son accès à l'administration suivent aussitôt.
        for membership in memberships:
            if isinstance(membership, OrganizationMembership):
                sync_member_access(membership.user)
