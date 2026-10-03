"""Retour sur une vente mise au cahier : la dette de la vente d'abord (dans la
limite de ce que le client doit encore), le surplus en argent."""

from decimal import Decimal
from uuid import uuid4

import pytest
from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient

from apps.cash.models import CashSession
from apps.cash.services import get_cash_session_summary
from apps.catalog.models import Product
from apps.customers.models import Customer, CustomerLedgerEntry
from apps.customers.services import (
    create_customer,
    customer_balance,
    record_customer_payment,
)
from apps.dashboard.services import get_manager_dashboard
from apps.inventory.models import Stock
from apps.sales.exceptions import InvalidCancellation, InvalidReturn
from apps.sales.models import Sale, SaleReturn
from apps.sales.services import cancel_sale, complete_sale, create_sale_return
from apps.stores.models import CashRegister, Store


pytestmark = pytest.mark.django_db
User = get_user_model()
Type = CustomerLedgerEntry.EntryType


@pytest.fixture
def cashier():
    return User.objects.create_user(username="cashier")


@pytest.fixture
def store() -> Store:
    return Store.objects.create(name="Supérette Test")


@pytest.fixture
def cash_session(store: Store, cashier) -> CashSession:
    register = CashRegister.objects.create(store=store, name="Caisse 01")
    return CashSession.objects.create(
        cash_register=register, cashier=cashier, opening_balance=Decimal("15000.00")
    )


@pytest.fixture
def product(store: Store) -> Product:
    product = Product.objects.create(name="Sac de riz 5kg", selling_price=Decimal("5000.00"))
    Stock.objects.create(store=store, product=product, quantity=20)
    return product


@pytest.fixture
def customer(store: Store) -> Customer:
    return create_customer(store=store, name="Moussa Fall", phone="771234567")


@pytest.fixture
def credit_sale(cash_session, product, customer) -> Sale:
    """10 000 : 4 000 en espèces, 6 000 au cahier."""
    return complete_sale(
        cash_session=cash_session,
        items=[{"product_id": product.id, "quantity": 2}],
        payments=[{"method": "CASH", "amount": Decimal("4000"), "received_amount": Decimal("4000")}],
        customer_id=customer.pk,
        credit_amount=Decimal("6000"),
    )


def _return(sale, cash_session, cashier, quantity, *, method="CASH", key=None):
    return create_sale_return(
        original_sale=sale,
        cash_session=cash_session,
        created_by=cashier,
        payment_method=method,
        idempotency_key=key or uuid4(),
        items=[{"sale_item_id": sale.items.get().id, "quantity": Decimal(quantity), "restock": True}],
    )


def _repay(customer, cash_session, cashier, amount):
    record_customer_payment(
        customer=customer, cash_session=cash_session, created_by=cashier, method="WAVE",
        amount=Decimal(amount), idempotency_key=uuid4(),
    )


def test_return_within_the_debt_only_reduces_the_book(credit_sale, cash_session, cashier, customer) -> None:
    sale_return = _return(credit_sale, cash_session, cashier, 1)

    entry = CustomerLedgerEntry.objects.get(entry_type=Type.RETURN_CREDIT)
    assert sale_return.total_refund == Decimal("5000.00")
    assert sale_return.credit_reduction == Decimal("5000.00")
    assert sale_return.money_refund == Decimal("0.00")
    # Aucun argent rendu : pas de moyen de remboursement, même si l'écran en a envoyé un.
    assert sale_return.payment_method is None
    assert entry.amount == Decimal("-5000.00")
    assert entry.sale == credit_sale
    assert entry.sale_return == sale_return
    assert entry.created_by == cashier
    assert customer_balance(customer) == Decimal("1000.00")
    assert Stock.objects.get(product=credit_sale.items.get().product).quantity == 19


def test_return_beyond_the_debt_refunds_the_surplus(credit_sale, cash_session, cashier, customer) -> None:
    sale_return = _return(credit_sale, cash_session, cashier, 2)

    assert sale_return.credit_reduction == Decimal("6000.00")
    assert sale_return.money_refund == Decimal("4000.00")
    assert sale_return.payment_method == "CASH"
    assert customer_balance(customer) == Decimal("0.00")


def test_successive_returns_never_erase_more_than_the_sale_credit(
    credit_sale, cash_session, cashier, customer
) -> None:
    first = _return(credit_sale, cash_session, cashier, 1)
    second = _return(credit_sale, cash_session, cashier, 1)

    assert first.credit_reduction == Decimal("5000.00")
    assert second.credit_reduction == Decimal("1000.00")
    assert second.money_refund == Decimal("4000.00")
    assert customer_balance(customer) == Decimal("0.00")


def test_a_customer_who_already_paid_gets_money_back(credit_sale, cash_session, cashier, customer) -> None:
    _repay(customer, cash_session, cashier, "6000")

    sale_return = _return(credit_sale, cash_session, cashier, 1, method="WAVE")

    assert sale_return.credit_reduction == Decimal("0.00")
    assert sale_return.money_refund == Decimal("5000.00")
    assert sale_return.payment_method == "WAVE"
    assert not CustomerLedgerEntry.objects.filter(entry_type=Type.RETURN_CREDIT).exists()
    assert customer_balance(customer) == Decimal("0.00")


def test_reduction_is_capped_by_what_the_customer_still_owes(
    credit_sale, cash_session, cashier, customer
) -> None:
    _repay(customer, cash_session, cashier, "4000")

    sale_return = _return(credit_sale, cash_session, cashier, 1)

    assert sale_return.credit_reduction == Decimal("2000.00")
    assert sale_return.money_refund == Decimal("3000.00")
    assert customer_balance(customer) == Decimal("0.00")


def test_a_money_refund_requires_a_method(credit_sale, cash_session, cashier, customer) -> None:
    with pytest.raises(InvalidReturn):
        _return(credit_sale, cash_session, cashier, 2, method=None)

    assert SaleReturn.objects.count() == 0
    assert customer_balance(customer) == Decimal("6000.00")


def test_replayed_return_erases_the_debt_once(credit_sale, cash_session, cashier, customer) -> None:
    key = uuid4()

    first = _return(credit_sale, cash_session, cashier, 1, key=key)
    second = _return(credit_sale, cash_session, cashier, 1, key=key)

    assert first.pk == second.pk
    assert CustomerLedgerEntry.objects.filter(entry_type=Type.RETURN_CREDIT).count() == 1
    assert customer_balance(customer) == Decimal("1000.00")


def test_database_requires_a_method_exactly_when_money_is_refunded(credit_sale, cash_session, cashier) -> None:
    with pytest.raises(IntegrityError), transaction.atomic():
        SaleReturn.objects.create(
            original_sale=credit_sale, cash_session=cash_session, created_by=cashier,
            total_refund=Decimal("5000"), credit_reduction=Decimal("1000"),
            payment_method=None, idempotency_key=uuid4(),
        )
    with pytest.raises(IntegrityError), transaction.atomic():
        SaleReturn.objects.create(
            original_sale=credit_sale, cash_session=cash_session, created_by=cashier,
            total_refund=Decimal("5000"), credit_reduction=Decimal("6000"),
            payment_method=None, idempotency_key=uuid4(),
        )


def test_cash_summary_counts_only_money_that_left_the_drawer(
    credit_sale, cash_session, cashier
) -> None:
    _return(credit_sale, cash_session, cashier, 2)  # 6 000 au cahier, 4 000 en espèces

    summary = get_cash_session_summary(cash_session=cash_session)

    assert summary.returns_total == Decimal("10000.00")
    assert summary.credit_returns == Decimal("6000.00")
    assert summary.cash_refunds == Decimal("4000.00")
    # Fond 15 000 + ventes espèces 4 000 − remboursement espèces 4 000.
    assert summary.expected_cash == Decimal("15000.00")


def test_dashboard_counts_only_money_refunds_per_method(credit_sale, cash_session, cashier, store) -> None:
    _return(credit_sale, cash_session, cashier, 1)  # entièrement au cahier

    dashboard = get_manager_dashboard(period="today", store_id=str(store.pk))

    assert dashboard.returns_total == Decimal("5000.00")
    assert dashboard.payment_totals["cash"] == Decimal("4000.00")


def test_a_returned_sale_can_no_longer_be_cancelled(credit_sale, cash_session, cashier, customer) -> None:
    _return(credit_sale, cash_session, cashier, 1)

    with pytest.raises(InvalidCancellation):
        cancel_sale(sale_id=credit_sale.id, cancelled_by=cashier)

    assert customer_balance(customer) == Decimal("1000.00")
    assert Stock.objects.get(product=credit_sale.items.get().product).quantity == 19


def test_sale_detail_announces_what_a_return_would_erase(
    credit_sale, cash_session, cashier, customer
) -> None:
    client = APIClient()
    client.force_authenticate(cashier)
    _repay(customer, cash_session, cashier, "1500")

    response = client.get(
        reverse("sale-detail", kwargs={"pk": credit_sale.pk}), {"cash_session_id": str(cash_session.pk)}
    )

    assert response.status_code == status.HTTP_200_OK
    assert response.data["credit_reducible"] == "4500.00"


def test_return_api_accepts_a_full_book_return_without_method(credit_sale, cash_session, cashier) -> None:
    client = APIClient()
    client.force_authenticate(cashier)

    response = client.post(
        reverse("sale-return-list"),
        {
            "sale_id": str(credit_sale.pk),
            "cash_session_id": str(cash_session.pk),
            "idempotency_key": str(uuid4()),
            "items": [{"sale_item_id": str(credit_sale.items.get().id), "quantity": "1", "restock": True}],
        },
        format="json",
    )

    assert response.status_code == status.HTTP_201_CREATED, response.data
    assert response.data["total_refund"] == "5000.00"
    assert response.data["credit_reduction"] == "5000.00"
    assert response.data["money_refund"] == "0.00"
    assert response.data["payment_method"] is None
