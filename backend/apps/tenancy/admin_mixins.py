"""Le back-office d'un commerce ne montre que ce commerce.

`TenantAdminMixin` s'ajoute à chaque `ModelAdmin` (et inline) métier :
listes, fiches, actions, recherche, historique, listes déroulantes des
formulaires, autocomplétions et filtres latéraux passent tous par le même
périmètre que l'API (`scoping.scope`). Le super-utilisateur de la
plateforme, lui, voit tout.
"""

from django.contrib import admin
from django.contrib.admin.utils import get_fields_from_path
from django.contrib.auth import get_user_model
from django.db.models import Model, QuerySet

from .context import get_tenant
from .models import Organization, OrganizationMembership
from .scoping import ORGANIZATION_PATHS, STORE_PATHS, scope


def is_platform_admin(request) -> bool:
    return request.user.is_active and request.user.is_superuser


def visible_store_ids(request) -> frozenset | None:
    """Magasins du compte ; `None` pour la plateforme (tous)."""
    if is_platform_admin(request):
        return None
    tenant = get_tenant(request)
    return tenant.store_ids if tenant else frozenset()


def visible_queryset(source: type[Model] | QuerySet, request) -> QuerySet:
    """`source` (modèle ou queryset) restreint à ce que la requête peut voir.

    Les tables globales (groupes, permissions, types de contenu) restent
    entières : ce sont des modèles de rôles, pas des données de commerce."""
    queryset = source.all() if isinstance(source, QuerySet) else source._default_manager.all()
    if is_platform_admin(request):
        return queryset
    tenant = get_tenant(request)
    label = queryset.model._meta.label
    if label in STORE_PATHS or label in ORGANIZATION_PATHS:
        return scope(queryset, tenant)
    if queryset.model is get_user_model():
        if tenant is None:
            return queryset.none()
        # Ses membres, désactivés compris (pour les réactiver) — sauf un compte
        # passé depuis à un autre commerce : il appartient à ce commerce-là,
        # son ancien commerce ne doit plus pouvoir le modifier ni même le voir.
        active_elsewhere = OrganizationMembership.objects.filter(is_active=True).exclude(
            organization=tenant.organization
        )
        return (
            queryset.filter(is_superuser=False, memberships__organization=tenant.organization)
            .exclude(pk__in=active_elsewhere.values("user_id"))
            .distinct()
        )
    if queryset.model is Organization:
        return queryset.filter(pk=tenant.organization.pk) if tenant else queryset.none()
    return queryset


class TenantRelatedFieldListFilter(admin.RelatedFieldListFilter):
    """Filtre latéral sur une relation (magasin, caisse, caissier,
    catégorie…) : seulement les choix du commerce, jamais ceux des autres."""

    def field_choices(self, field, request, model_admin):
        queryset = visible_queryset(field.remote_field.model, request)
        ordering = self.field_admin_ordering(field, request, model_admin)
        if ordering:
            queryset = queryset.order_by(*ordering)
        return [(obj.pk, str(obj)) for obj in queryset]


class TenantAdminMixin:
    def get_queryset(self, request):
        return visible_queryset(super().get_queryset(request), request)

    def formfield_for_foreignkey(self, db_field, request, **kwargs):
        if "queryset" not in kwargs:
            kwargs["queryset"] = self._visible_choices(db_field, request)
        return super().formfield_for_foreignkey(db_field, request, **kwargs)

    def formfield_for_manytomany(self, db_field, request, **kwargs):
        if "queryset" not in kwargs:
            kwargs["queryset"] = self._visible_choices(db_field, request)
        return super().formfield_for_manytomany(db_field, request, **kwargs)

    def _visible_choices(self, db_field, request) -> QuerySet:
        # Le tri de l'admin du modèle lié, s'il en a un, comme Django.
        ordered = self.get_field_queryset(None, db_field, request)
        return visible_queryset(
            ordered if ordered is not None else db_field.remote_field.model, request
        )

    def get_list_filter(self, request):
        filters = []
        for item in super().get_list_filter(request):
            if isinstance(item, str) and get_fields_from_path(self.model, item)[-1].is_relation:
                item = (item, TenantRelatedFieldListFilter)
            filters.append(item)
        return filters
