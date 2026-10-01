"""Les liens entre commerces qu'aucune clé étrangère ne peut interdire.

Une vente pointe vers une session, un produit et un client ; chacun a son
propre chemin vers un commerce, et rien en base n'oblige ces chemins à se
rejoindre. Les services l'imposent (phase 3) ; ces requêtes le vérifient
après coup, sur toute la base, pour qu'un chemin oublié se voie.
"""

from dataclasses import dataclass

from django.db.models import Exists, F, OuterRef, QuerySet, Subquery

from apps.customers.models import CustomerLedgerEntry, CustomerPayment
from apps.expenses.models import Expense
from apps.inventory.models import InventoryMovement, Stock, StockCostChange
from apps.sales.models import Sale, SaleItem, SaleReturn
from apps.stores.models import StoreAssignment
from apps.sync.models import ProcessedSyncEvent

from .models import OrganizationMembership

SALE_STORE = "cash_session__cash_register__store"


@dataclass(frozen=True)
class IntegrityRule:
    label: str
    violations: QuerySet


def _assignments_to_another_commerce() -> QuerySet:
    elsewhere = OrganizationMembership.objects.filter(
        user=OuterRef("user"), is_active=True
    ).exclude(organization=OuterRef("store__organization"))
    return StoreAssignment.objects.filter(is_active=True).filter(Exists(elsewhere))


def _sync_events_off_their_sale() -> QuerySet:
    sale_store = Sale.objects.filter(pk=OuterRef("entity_id")).values(f"{SALE_STORE}_id")[:1]
    return (
        ProcessedSyncEvent.objects.filter(store__isnull=False)
        .annotate(sale_store=Subquery(sale_store))
        .filter(sale_store__isnull=False)
        .exclude(sale_store=F("store_id"))
    )


def integrity_rules() -> list[IntegrityRule]:
    return [
        IntegrityRule(
            "Stock d'un produit d'un autre commerce",
            Stock.objects.exclude(product__organization=F("store__organization")),
        ),
        IntegrityRule(
            "Mouvement de stock d'un produit d'un autre commerce",
            InventoryMovement.objects.exclude(product__organization=F("store__organization")),
        ),
        IntegrityRule(
            "Changement de coût d'un produit d'un autre commerce",
            StockCostChange.objects.exclude(product__organization=F("store__organization")),
        ),
        IntegrityRule(
            "Ligne de vente d'un produit d'un autre commerce",
            SaleItem.objects.exclude(
                product__organization=F(f"sale__{SALE_STORE}__organization")
            ),
        ),
        IntegrityRule(
            "Vente au cahier d'un client d'un autre magasin",
            Sale.objects.filter(customer__isnull=False).exclude(customer__store=F(SALE_STORE)),
        ),
        IntegrityRule(
            "Retour d'une vente d'un autre magasin",
            SaleReturn.objects.exclude(original_sale__cash_session__cash_register__store=F(SALE_STORE)),
        ),
        IntegrityRule(
            "Remboursement d'un client d'un autre magasin",
            CustomerPayment.objects.exclude(customer__store=F("store")),
        ),
        IntegrityRule(
            "Remboursement encaissé dans la caisse d'un autre magasin",
            CustomerPayment.objects.exclude(**{f"{SALE_STORE}": F("store")}),
        ),
        IntegrityRule(
            "Écriture du cahier hors du magasin de son client",
            CustomerLedgerEntry.objects.exclude(customer__store=F("store")),
        ),
        IntegrityRule(
            "Écriture du cahier liée à une vente d'un autre magasin",
            CustomerLedgerEntry.objects.filter(sale__isnull=False).exclude(
                **{f"sale__{SALE_STORE}": F("store")}
            ),
        ),
        IntegrityRule(
            "Dépense dans une catégorie d'un autre commerce",
            Expense.objects.exclude(category__organization=F("store__organization")),
        ),
        IntegrityRule(
            "Dépense payée depuis la caisse d'un autre magasin",
            Expense.objects.filter(cash_session__isnull=False).exclude(
                **{f"{SALE_STORE}": F("store")}
            ),
        ),
        IntegrityRule(
            "Événement de sync rattaché à un autre magasin que sa vente",
            _sync_events_off_their_sale(),
        ),
        IntegrityRule(
            "Affectation à un magasin d'un autre commerce que celui du compte",
            _assignments_to_another_commerce(),
        ),
    ]


def find_violations() -> list[tuple[IntegrityRule, int]]:
    """Les règles enfreintes, avec le nombre de lignes en cause."""
    return [
        (rule, count)
        for rule in integrity_rules()
        if (count := rule.violations.count())
    ]
