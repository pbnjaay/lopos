from django.db.models import QuerySet

from apps.tenancy.context import resolve_tenant

from .models import CashRegister, Store


def _store_ids(user) -> frozenset:
    """Magasins du compte, toujours tirés de son commerce. Ni `is_staff` ni
    `is_superuser` n'y ajoutent rien : le super-utilisateur administre la
    plateforme depuis l'admin, il ne travaille dans aucun magasin."""
    tenant = resolve_tenant(user)
    return tenant.store_ids if tenant else frozenset()


def stores_accessible_to(user) -> QuerySet[Store]:
    return Store.objects.filter(pk__in=_store_ids(user), is_active=True)


def cash_registers_accessible_to(user) -> QuerySet[CashRegister]:
    return CashRegister.objects.select_related("store").filter(
        store_id__in=_store_ids(user), is_active=True, store__is_active=True
    )


def user_can_access_store(user, store: Store) -> bool:
    return store.pk in _store_ids(user)


def user_can_manage_store(user, store_id) -> bool:
    """Agir sur le travail d'un autre dans ce magasin : annuler sa vente ou
    sa dépense, consulter ou clôturer sa caisse. Propriétaire, ou gérant
    affecté au magasin."""
    tenant = resolve_tenant(user)
    return tenant is not None and tenant.can_manage_store(store_id)
