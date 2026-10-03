"""Dépenses et caisse : les espèces dépensées sortent du cash attendu, Wave/OM
n'y touchent pas, une annulation les y remet ; jamais plus d'espèces que le
tiroir n'en contient."""

from decimal import Decimal
from uuid import uuid4

import pytest
from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.test import APIClient

from apps.cash.models import CashSession
from apps.cash.services import close_cash_session, get_cash_session_summary
from apps.catalog.models import Product
from apps.customers.services import (
    create_customer,
    record_customer_payment,
    record_opening_balance,
)
from apps.expenses.exceptions import InsufficientCash
from apps.expenses.models import Expense, ExpenseCategory
from apps.expenses.services import cancel_expense, create_expense, ensure_default_categories
from apps.inventory.models import Stock
from apps.sales.services import complete_sale, create_sale_return
from apps.stores.models import CashRegister, Store, StoreAssignment


pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def no_manager_approval_threshold(settings):
    """Ce module teste le cahier et le tiroir, pas la validation par un
    gérant (voir test_cashier_approvals) : seuil hors d'atteinte."""
    settings.APPROVAL_AMOUNT_THRESHOLD = Decimal("1000000000")


User = get_user_model()


@pytest.fixture
def cashier():
    return User.objects.create_user(username="cashier")


@pytest.fixture
def store() -> Store:
    return Store.objects.create(name="Supérette Test")


@pytest.fixture
def cash_session(store: Store, cashier) -> CashSession:
    # Une caisse ne s'ouvre que dans un magasin où le caissier est affecté.
    StoreAssignment.objects.get_or_create(user=cashier, store=store)
    register = CashRegister.objects.create(store=store, name="Caisse 01")
    return CashSession.objects.create(
        cash_register=register, cashier=cashier, opening_balance=Decimal("20000.00")
    )


@pytest.fixture
def category() -> ExpenseCategory:
    ensure_default_categories()
    return ExpenseCategory.objects.get(name="Électricité")


def _expense(cash_session, cashier, category, amount, method="CASH") -> Expense:
    return create_expense(
        cash_session=cash_session,
        created_by=cashier,
        category=category,
        amount=Decimal(amount),
        payment_method=method,
        idempotency_key=uuid4(),
    )


def _cash_sale(cash_session, product, quantity: int):
    amount = product.selling_price * quantity
    return complete_sale(
        cash_session=cash_session,
        items=[{"product_id": product.id, "quantity": quantity}],
        payments=[{"method": "CASH", "amount": amount, "received_amount": amount}],
    )


def test_full_day_expected_cash(store, cash_session, cashier, category) -> None:
    """Fond 20 000 + ventes espèces 80 000 + paiement client espèces 10 000
    − remboursement espèces 5 000 − dépenses espèces 15 000 = 90 000."""
    product = Product.objects.create(name="Riz", selling_price=Decimal("5000.00"))
    Stock.objects.create(store=store, product=product, quantity=50)
    _cash_sale(cash_session, product, 15)
    small_sale = _cash_sale(cash_session, product, 1)

    customer = create_customer(store=store, name="Moussa Fall", phone="771234567")
    record_opening_balance(customer=customer, amount=Decimal("10000"))
    record_customer_payment(
        customer=customer,
        cash_session=cash_session,
        created_by=cashier,
        method="CASH",
        amount=Decimal("10000"),
        received_amount=Decimal("10000"),
        idempotency_key=uuid4(),
    )

    create_sale_return(
        original_sale=small_sale,
        cash_session=cash_session,
        created_by=cashier,
        items=[{"sale_item_id": small_sale.items.get().id, "quantity": Decimal("1"), "restock": True}],
        idempotency_key=uuid4(),
        payment_method="CASH",
    )

    _expense(cash_session, cashier, category, "15000")
    # Payées hors du tiroir : visibles au rapport, sans effet sur les espèces.
    _expense(cash_session, cashier, category, "7000", method="WAVE")
    _expense(cash_session, cashier, category, "3000", method="ORANGE_MONEY")

    summary = get_cash_session_summary(cash_session=cash_session)

    assert summary.cash_sales == Decimal("80000.00")
    assert summary.cash_customer_payments == Decimal("10000.00")
    assert summary.cash_refunds == Decimal("5000.00")
    assert summary.expenses_count == 3
    assert summary.cash_expenses == Decimal("15000.00")
    assert summary.wave_expenses == Decimal("7000.00")
    assert summary.orange_money_expenses == Decimal("3000.00")
    assert summary.expected_cash == Decimal("90000.00")
    # Une dépense n'est jamais une vente.
    assert summary.gross_sales == Decimal("80000.00")
    assert summary.net_sales == Decimal("75000.00")

    closed = close_cash_session(cash_session=cash_session, counted_cash=Decimal("90000"))
    assert closed.expected_balance == Decimal("90000.00")
    assert closed.difference == Decimal("0.00")


def test_mobile_money_expenses_leave_expected_cash_unchanged(cash_session, cashier, category) -> None:
    _expense(cash_session, cashier, category, "25000", method="WAVE")
    _expense(cash_session, cashier, category, "25000", method="ORANGE_MONEY")

    summary = get_cash_session_summary(cash_session=cash_session)

    assert summary.expected_cash == Decimal("20000.00")


def test_cancelling_a_cash_expense_puts_it_back(cash_session, cashier, category) -> None:
    expense = _expense(cash_session, cashier, category, "5000")
    assert get_cash_session_summary(cash_session=cash_session).expected_cash == Decimal("15000.00")

    cancel_expense(expense=expense, cancelled_by=cashier, reason="Saisie en double")

    summary = get_cash_session_summary(cash_session=cash_session)
    assert summary.expected_cash == Decimal("20000.00")
    assert summary.cash_expenses == Decimal("0.00")
    assert summary.expenses_count == 0


def test_cash_expense_cannot_exceed_the_drawer(cash_session, cashier, category) -> None:
    _expense(cash_session, cashier, category, "15000")

    with pytest.raises(InsufficientCash) as excinfo:
        _expense(cash_session, cashier, category, "5001")

    assert excinfo.value.available == Decimal("5000.00")
    assert "5 000 FCFA" in str(excinfo.value)
    # Exactement ce qu'il reste : accepté, le tiroir est vide.
    _expense(cash_session, cashier, category, "5000")
    assert get_cash_session_summary(cash_session=cash_session).expected_cash == Decimal("0.00")
    close_cash_session(cash_session=cash_session, counted_cash=Decimal("0"))


def test_mobile_money_expense_is_not_limited_by_the_drawer(cash_session, cashier, category) -> None:
    expense = _expense(cash_session, cashier, category, "500000", method="WAVE")

    assert expense.amount == Decimal("500000.00")


def test_cancelled_expense_frees_room_in_the_drawer(cash_session, cashier, category) -> None:
    expense = _expense(cash_session, cashier, category, "20000")
    cancel_expense(expense=expense, cancelled_by=cashier, reason="Erreur de montant")

    assert _expense(cash_session, cashier, category, "20000").pk


def test_expenses_of_other_sessions_do_not_count(store, cash_session, cashier, category) -> None:
    other_cashier = User.objects.create_user(username="other")
    other_register = CashRegister.objects.create(store=store, name="Caisse 02")
    other_session = CashSession.objects.create(
        cash_register=other_register, cashier=other_cashier, opening_balance=Decimal("10000")
    )
    _expense(other_session, other_cashier, category, "10000")

    summary = get_cash_session_summary(cash_session=cash_session)

    assert summary.expected_cash == Decimal("20000.00")
    assert summary.expenses_count == 0


def test_summary_api_exposes_expenses(cash_session, cashier, category) -> None:
    _expense(cash_session, cashier, category, "4000")
    _expense(cash_session, cashier, category, "1500", method="WAVE")
    client = APIClient()
    client.force_authenticate(cashier)

    response = client.get(
        reverse("cash-session-summary", kwargs={"pk": cash_session.pk})
    )

    assert response.status_code == 200, response.content
    body = response.json()
    assert body["expenses_count"] == 2
    assert body["expenses"] == {"cash": "4000.00", "wave": "1500.00", "orange_money": "0.00"}
    assert body["expected_cash"] == "16000.00"
