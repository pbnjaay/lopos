"""Phase 6 : `tenancy_check` repère toute donnée qui relie deux commerces.

Les incohérences sont injectées en contournant les services (update direct,
gestionnaire de base pour les modèles immuables) : exactement ce qu'un
chemin de code oublié pourrait produire.
"""

from decimal import Decimal
from io import StringIO
from uuid import uuid4

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

from apps.customers.models import CustomerLedgerEntry, CustomerPayment
from apps.expenses.models import Expense
from apps.inventory.models import InventoryMovement, Stock, StockCostChange
from apps.sales.models import Sale, SaleItem, SaleReturn
from apps.stores.models import StoreAssignment
from apps.sync.models import ProcessedSyncEvent
from apps.tenancy.integrity import integrity_rules

from .tenancy_factories import Commerce, build_commerce

pytestmark = [pytest.mark.django_db, pytest.mark.explicit_tenancy]


@pytest.fixture
def a() -> Commerce:
    return build_commerce("a")


@pytest.fixture
def b() -> Commerce:
    return build_commerce("b")


def _check() -> str:
    out = StringIO()
    call_command("tenancy_check", stdout=out)
    return out.getvalue()


def test_two_commerces_built_through_the_services_are_consistent(a, b) -> None:
    assert "Aucune donnée ne relie deux commerces." in _check()


def _stock(a, b):
    Stock.objects.filter(store=a.store).update(product=b.product)


def _movement(a, b):
    InventoryMovement.objects.filter(store=a.store).update(product=b.product)


def _cost_change(a, b):
    StockCostChange.objects.create(
        store=a.store, product=b.product, source="INITIAL", new_cost=Decimal("1"),
        quantity_at_change=Decimal("0"),
    )


def _sale_item(a, b):
    SaleItem.objects.filter(sale=a.sale).update(product=b.product)


def _sale_customer(a, b):
    Sale.objects.filter(pk=a.sale.pk).update(customer=b.customer)


def _sale_return(a, b):
    SaleReturn.objects.filter(pk=a.sale_return.pk).update(original_sale=b.sale)


def _payment_customer(a, b):
    CustomerPayment.objects.filter(pk=a.payment.pk).update(customer=b.customer)


def _payment_session(a, b):
    CustomerPayment.objects.filter(pk=a.payment.pk).update(cash_session=b.session)


def _ledger_customer(a, b):
    # Le remboursement : un solde d'ouverture par client interdirait de
    # déplacer l'écriture d'ouverture.
    CustomerLedgerEntry._base_manager.filter(store=a.store, entry_type="PAYMENT").update(
        customer=b.customer
    )


def _ledger_sale(a, b):
    CustomerLedgerEntry.objects.create(
        customer=a.customer, store=a.store, entry_type="CREDIT_SALE",
        amount=Decimal("1000"), sale=b.sale,
    )


def _expense_category(a, b):
    Expense._base_manager.filter(pk=a.expense.pk).update(category=b.category)


def _expense_session(a, b):
    Expense._base_manager.filter(pk=a.expense.pk).update(cash_session=b.session)


def _sync_event(a, b):
    ProcessedSyncEvent.objects.create(
        event_id=uuid4(), terminal_id=uuid4(), event_type="SALE_COMPLETED",
        entity_id=a.sale.pk, store=b.store,
    )


def _assignment(a, b):
    StoreAssignment.objects.create(user=b.cashier, store=a.store)


@pytest.mark.parametrize(
    ("inject", "label"),
    [
        (_stock, "Stock d'un produit d'un autre commerce"),
        (_movement, "Mouvement de stock d'un produit d'un autre commerce"),
        (_cost_change, "Changement de coût d'un produit d'un autre commerce"),
        (_sale_item, "Ligne de vente d'un produit d'un autre commerce"),
        (_sale_customer, "Vente au cahier d'un client d'un autre magasin"),
        (_sale_return, "Retour d'une vente d'un autre magasin"),
        (_payment_customer, "Remboursement d'un client d'un autre magasin"),
        (_payment_session, "Remboursement encaissé dans la caisse d'un autre magasin"),
        (_ledger_customer, "Écriture du cahier hors du magasin de son client"),
        (_ledger_sale, "Écriture du cahier liée à une vente d'un autre magasin"),
        (_expense_category, "Dépense dans une catégorie d'un autre commerce"),
        (_expense_session, "Dépense payée depuis la caisse d'un autre magasin"),
        (_sync_event, "Événement de sync rattaché à un autre magasin que sa vente"),
        (_assignment, "Affectation à un magasin d'un autre commerce que celui du compte"),
    ],
)
def test_each_cross_commerce_link_is_reported(a, b, inject, label) -> None:
    inject(a, b)
    out = StringIO()

    with pytest.raises(CommandError, match="relient deux commerces"):
        call_command("tenancy_check", stdout=out)

    assert f"✗ {label}" in out.getvalue()


def test_every_rule_is_exercised_above() -> None:
    assert len(integrity_rules()) == 14


def test_assignment_of_a_member_simply_removed_is_not_an_incoherence(a) -> None:
    from apps.tenancy.models import OrganizationMembership

    OrganizationMembership.objects.filter(user=a.cashier).update(is_active=False)

    assert "Aucune donnée ne relie deux commerces." in _check()
