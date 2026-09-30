from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from threading import Barrier
from uuid import uuid4

import pytest
from django.contrib.auth import get_user_model
from django.db import close_old_connections, connection, connections

from apps.cash.models import CashSession
from apps.expenses.models import Expense, ExpenseCategory
from apps.expenses.services import cancel_expense, create_expense, ensure_default_categories
from apps.stores.models import CashRegister, Store


User = get_user_model()


def _attempt_create(*, cash_session_id, cashier_id, category_id, key, start_barrier: Barrier):
    close_old_connections()
    try:
        cash_session = CashSession.objects.get(pk=cash_session_id)
        cashier = User.objects.get(pk=cashier_id)
        category = ExpenseCategory.objects.get(pk=category_id)
        start_barrier.wait(timeout=10)
        return create_expense(
            cash_session=cash_session,
            created_by=cashier,
            category=category,
            amount=Decimal("15000"),
            payment_method="CASH",
            idempotency_key=key,
        ).pk
    finally:
        connections["default"].close()


def _attempt_cancel(*, expense_id, user_id, start_barrier: Barrier) -> str:
    close_old_connections()
    try:
        expense = Expense.objects.get(pk=expense_id)
        user = User.objects.get(pk=user_id)
        start_barrier.wait(timeout=10)
        try:
            cancel_expense(expense=expense, cancelled_by=user, reason="Doublon")
        except Exception as exc:  # noqa: BLE001 — on compare le type ci-dessous
            return type(exc).__name__
        return "cancelled"
    finally:
        connections["default"].close()


@pytest.fixture
def setup():
    ensure_default_categories()
    cashier = User.objects.create_user(username="cashier", is_staff=True)
    store = Store.objects.create(name="Supérette Test")
    register = CashRegister.objects.create(store=store, name="Caisse 01")
    session = CashSession.objects.create(
        cash_register=register, cashier=cashier, opening_balance=Decimal("20000")
    )
    return session, cashier, ExpenseCategory.objects.get(name="Transport")


@pytest.mark.django_db(transaction=True)
def test_concurrent_retries_create_a_single_expense(setup) -> None:
    """Le POS renvoie la même dépense deux fois en même temps (double clic,
    réponse perdue) : les deux appels rendent la même dépense."""
    assert connection.vendor == "postgresql"
    session, cashier, category = setup
    key = uuid4()

    barrier = Barrier(2)
    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [
            executor.submit(
                _attempt_create,
                cash_session_id=session.pk,
                cashier_id=cashier.pk,
                category_id=category.pk,
                key=key,
                start_barrier=barrier,
            )
            for _ in range(2)
        ]
        ids = {future.result(timeout=30) for future in futures}

    assert len(ids) == 1
    assert Expense.objects.count() == 1


@pytest.mark.django_db(transaction=True)
def test_concurrent_cancellations_cancel_once(setup) -> None:
    session, cashier, category = setup
    expense = create_expense(
        cash_session=session,
        created_by=cashier,
        category=category,
        amount=Decimal("5000"),
        payment_method="CASH",
        idempotency_key=uuid4(),
    )

    barrier = Barrier(2)
    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [
            executor.submit(
                _attempt_cancel, expense_id=expense.pk, user_id=cashier.pk, start_barrier=barrier
            )
            for _ in range(2)
        ]
        outcomes = sorted(future.result(timeout=30) for future in futures)

    assert outcomes == ["ExpenseAlreadyCancelled", "cancelled"]
