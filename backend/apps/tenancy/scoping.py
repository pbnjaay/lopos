"""Ce qu'un compte peut voir : un seul endroit pour chaque modèle.

Chaque modèle métier déclare ici son chemin vers le magasin (données d'un
magasin) ou vers l'organisation (données partagées par les magasins d'un
commerce). `scope()` filtre tout queryset en conséquence ; un modèle absent
de ces tables est refusé plutôt que laissé visible.
"""

from django.core.exceptions import ImproperlyConfigured
from django.db.models import QuerySet

from .context import TenantContext

# Données d'un magasin : visibles seulement dans les magasins accessibles.
STORE_PATHS: dict[str, str] = {
    "stores.Store": "pk",
    "stores.CashRegister": "store_id",
    "stores.StoreAssignment": "store_id",
    "cash.CashSession": "cash_register__store_id",
    "sales.Sale": "cash_session__cash_register__store_id",
    "sales.SaleItem": "sale__cash_session__cash_register__store_id",
    "sales.Payment": "sale__cash_session__cash_register__store_id",
    "sales.SaleReturn": "cash_session__cash_register__store_id",
    "sales.SaleReturnItem": "sale_return__cash_session__cash_register__store_id",
    "customers.Customer": "store_id",
    "customers.CustomerPayment": "store_id",
    "customers.CustomerLedgerEntry": "store_id",
    "expenses.Expense": "store_id",
    "inventory.Stock": "store_id",
    "inventory.StockValuation": "store_id",
    "inventory.InventoryMovement": "store_id",
    "inventory.StockCostChange": "store_id",
    "sync.ProcessedSyncEvent": "store_id",
}

# Données du commerce : visibles depuis tous ses magasins.
ORGANIZATION_PATHS: dict[str, str] = {
    "catalog.Product": "organization_id",
    "expenses.ExpenseCategory": "organization_id",
}


def scope(queryset: QuerySet, tenant: TenantContext | None) -> QuerySet:
    """Restreint `queryset` (ou un manager) à ce que `tenant` peut voir ;
    rien sans tenant."""
    queryset = queryset.all()
    if tenant is None:
        return queryset.none()
    label = queryset.model._meta.label
    if label in STORE_PATHS:
        return queryset.filter(**{f"{STORE_PATHS[label]}__in": tenant.store_ids})
    if label in ORGANIZATION_PATHS:
        return queryset.filter(**{ORGANIZATION_PATHS[label]: tenant.organization.pk})
    raise ImproperlyConfigured(f"{label} n'a pas de portée tenant déclarée.")


def scope_to_organization(queryset: QuerySet, tenant: TenantContext | None) -> QuerySet:
    """Variante plus large pour les données d'un magasin : tout le commerce,
    y compris ses magasins où le compte n'est pas affecté. Réservée au sync,
    où une vente hors ligne ne doit jamais être perdue parce que son
    caissier a changé d'affectation entre-temps."""
    queryset = queryset.all()
    if tenant is None:
        return queryset.none()
    label = queryset.model._meta.label
    if label not in STORE_PATHS:
        raise ImproperlyConfigured(f"{label} n'est pas une donnée de magasin.")
    path = STORE_PATHS[label].removesuffix("_id").removesuffix("pk")
    lookup = f"{path}__organization_id" if path else "organization_id"
    return queryset.filter(**{lookup: tenant.organization.pk})
