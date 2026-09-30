"""Invariants des dépenses tenus par la base et par le modèle lui-même, même
si le service est contourné."""

from decimal import Decimal
from uuid import uuid4

import pytest
from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.cash.models import CashSession
from apps.expenses.exceptions import ImmutableExpense
from apps.expenses.models import Expense, ExpenseCategory
from apps.expenses.services import cancel_expense, create_expense
from apps.stores.models import CashRegister, Store


pytestmark = pytest.mark.django_db
User = get_user_model()


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
        cash_register=register, cashier=cashier, opening_balance=Decimal("0")
    )


@pytest.fixture
def category() -> ExpenseCategory:
    return ExpenseCategory.objects.create(name="Test transport")


def _raw(store, cashier, category, **overrides) -> Expense:
    """Écriture directe, sans le service : seule la base protège."""
    params = dict(
        store=store,
        category=category,
        amount=Decimal("1000"),
        payment_method="WAVE",
        created_by=cashier,
        idempotency_key=uuid4(),
    )
    params.update(overrides)
    with transaction.atomic():
        return Expense.objects.create(**params)


@pytest.mark.parametrize("amount", [Decimal("0"), Decimal("-1")])
def test_database_rejects_non_positive_amounts(store, cashier, category, amount) -> None:
    with pytest.raises(IntegrityError):
        _raw(store, cashier, category, amount=amount)


def test_database_rejects_unknown_payment_method(store, cashier, category) -> None:
    with pytest.raises(IntegrityError):
        _raw(store, cashier, category, payment_method="CREDIT")


def test_database_requires_a_session_for_cash(store, cashier, category, cash_session) -> None:
    with pytest.raises(IntegrityError):
        _raw(store, cashier, category, payment_method="CASH")

    assert _raw(store, cashier, category, payment_method="CASH", cash_session=cash_session).pk
    # Wave/OM hors caisse restent possibles (futur back-office).
    assert _raw(store, cashier, category, payment_method="ORANGE_MONEY").pk


def test_database_requires_complete_cancellation_details(store, cashier, category) -> None:
    with pytest.raises(IntegrityError):
        _raw(store, cashier, category, status="CANCELLED", cancelled_at=timezone.now(), cancelled_by=cashier)
    with pytest.raises(IntegrityError):
        _raw(store, cashier, category, cancellation_reason="Erreur")


def test_idempotency_key_is_unique(store, cashier, category) -> None:
    key = uuid4()
    _raw(store, cashier, category, idempotency_key=key)

    with pytest.raises(IntegrityError):
        _raw(store, cashier, category, idempotency_key=key)


def test_expense_cannot_be_edited_or_deleted(cash_session, cashier, category) -> None:
    expense = create_expense(
        cash_session=cash_session,
        created_by=cashier,
        category=category,
        amount=Decimal("5000"),
        payment_method="WAVE",
        idempotency_key=uuid4(),
    )

    expense.amount = Decimal("1")
    with pytest.raises(ImmutableExpense):
        expense.save()
    with pytest.raises(ImmutableExpense):
        expense.save(update_fields=("amount",))
    with pytest.raises(ImmutableExpense):
        expense.delete()
    with pytest.raises(ImmutableExpense):
        Expense.objects.filter(pk=expense.pk).update(amount=Decimal("1"))
    with pytest.raises(ImmutableExpense):
        Expense.objects.filter(pk=expense.pk).delete()

    expense.refresh_from_db()
    assert expense.amount == Decimal("5000.00")


def test_cancellation_is_the_only_allowed_change(cash_session, cashier, category) -> None:
    expense = create_expense(
        cash_session=cash_session,
        created_by=cashier,
        category=category,
        amount=Decimal("5000"),
        payment_method="WAVE",
        idempotency_key=uuid4(),
    )

    cancel_expense(expense=expense, cancelled_by=cashier, reason="Doublon")

    expense.refresh_from_db()
    assert expense.status == Expense.Status.CANCELLED
    assert expense.amount == Decimal("5000.00")


def test_category_name_cannot_be_empty() -> None:
    with pytest.raises(IntegrityError):
        ExpenseCategory.objects.create(name="")
