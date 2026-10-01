from django.db.models import QuerySet

from apps.tenancy.context import resolve_tenant

from .models import CashRegister, Store


def _store_ids(user) -> frozenset | None:
    """Magasins du compte ; None pour un super-utilisateur de la plateforme,
    qui les voit tous. `is_staff` ne donne plus aucun accès : il ouvre
    seulement l'administration."""
    if user.is_superuser:
        return None
    tenant = resolve_tenant(user)
    return tenant.store_ids if tenant else frozenset()


def stores_accessible_to(user) -> QuerySet[Store]:
    store_ids = _store_ids(user)
    queryset = Store.objects.all()
    if store_ids is None:
        return queryset
    return queryset.filter(pk__in=store_ids, is_active=True)


def cash_registers_accessible_to(user) -> QuerySet[CashRegister]:
    store_ids = _store_ids(user)
    queryset = CashRegister.objects.select_related("store")
    if store_ids is None:
        return queryset
    return queryset.filter(store_id__in=store_ids, is_active=True, store__is_active=True)


def user_can_access_store(user, store: Store) -> bool:
    store_ids = _store_ids(user)
    return store_ids is None or store.pk in store_ids


def user_can_manage_store(user, store_id) -> bool:
    """Agir sur le travail d'un autre dans ce magasin : annuler sa vente ou
    sa dépense, consulter ou clôturer sa caisse. Propriétaire, ou gérant
    affecté au magasin."""
    if user.is_superuser:
        return True
    tenant = resolve_tenant(user)
    return tenant is not None and tenant.can_manage_store(store_id)
