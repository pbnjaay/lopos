"""Dépenses : saisie dans la session ouverte de son caissier, idempotente,
jamais modifiée ; correction par annulation tant que la session est ouverte."""

from decimal import Decimal
from uuid import uuid4

import pytest
from django.contrib.auth import get_user_model

from apps.cash.exceptions import CashSessionClosed
from apps.cash.models import CashSession
from apps.cash.services import close_cash_session
from apps.customers.models import CustomerLedgerEntry
from apps.expenses.exceptions import (
    ExpenseAlreadyCancelled,
    ExpenseCancellationNotAllowed,
    ExpenseNotCancellable,
    ExpenseSessionNotOwned,
    InvalidExpense,
)
from apps.expenses.models import Expense, ExpenseCategory
from apps.expenses.services import cancel_expense, create_expense, ensure_default_categories
from apps.inventory.models import InventoryMovement, Stock
from apps.sales.models import Sale
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
        cash_register=register, cashier=cashier, opening_balance=Decimal("50000.00")
    )


@pytest.fixture
def electricity() -> ExpenseCategory:
    ensure_default_categories()
    return ExpenseCategory.objects.get(name="Électricité")


@pytest.fixture
def other() -> ExpenseCategory:
    ensure_default_categories()
    return ExpenseCategory.objects.get(name="Autre")


def _create(cash_session, cashier, category, **overrides) -> Expense:
    params = dict(
        cash_session=cash_session,
        created_by=cashier,
        category=category,
        amount=Decimal("25000"),
        payment_method="CASH",
        description="Facture août",
        idempotency_key=uuid4(),
    )
    params.update(overrides)
    return create_expense(**params)


# --- Création ---------------------------------------------------------------


@pytest.mark.parametrize("method", ["CASH", "WAVE", "ORANGE_MONEY"])
def test_expense_belongs_to_the_session_of_its_cashier(
    cash_session, cashier, store, electricity, method
) -> None:
    expense = _create(cash_session, cashier, electricity, payment_method=method)

    assert expense.status == Expense.Status.POSTED
    assert expense.store == store
    assert expense.cash_session == cash_session
    assert expense.created_by == cashier
    assert expense.amount == Decimal("25000.00")
    assert expense.payment_method == method
    assert expense.reference.startswith("DEP-")


def test_expense_touches_neither_sales_stock_nor_customer_book(
    cash_session, cashier, electricity
) -> None:
    _create(cash_session, cashier, electricity)

    assert Sale.objects.count() == 0
    assert Stock.objects.count() == 0
    assert InventoryMovement.objects.count() == 0
    assert CustomerLedgerEntry.objects.count() == 0


@pytest.mark.parametrize("amount", [Decimal("0"), Decimal("-5000"), 0, -1])
def test_zero_or_negative_amount_is_rejected(cash_session, cashier, electricity, amount) -> None:
    with pytest.raises(InvalidExpense, match="strictement positif"):
        _create(cash_session, cashier, electricity, amount=amount)
    assert Expense.objects.count() == 0


@pytest.mark.parametrize("amount", [25000.0, "25000", True, Decimal("10.001")])
def test_inexact_amount_is_rejected(cash_session, cashier, electricity, amount) -> None:
    with pytest.raises(InvalidExpense):
        _create(cash_session, cashier, electricity, amount=amount)


def test_unknown_payment_method_is_rejected(cash_session, cashier, electricity) -> None:
    with pytest.raises(InvalidExpense, match="Mode de paiement"):
        _create(cash_session, cashier, electricity, payment_method="CREDIT")


def test_closed_session_is_rejected(cash_session, cashier, electricity) -> None:
    close_cash_session(cash_session=cash_session, counted_cash=Decimal("50000"))

    with pytest.raises(CashSessionClosed):
        _create(cash_session, cashier, electricity)


def test_session_of_another_cashier_is_rejected(cash_session, electricity) -> None:
    colleague = User.objects.create_user(username="colleague")

    with pytest.raises(ExpenseSessionNotOwned):
        _create(cash_session, colleague, electricity)


def test_inactive_category_is_rejected(cash_session, cashier, electricity) -> None:
    electricity.is_active = False
    electricity.save()

    with pytest.raises(InvalidExpense, match="n’est plus utilisée"):
        _create(cash_session, cashier, electricity)


def test_description_is_required_when_the_category_says_so(cash_session, cashier, other) -> None:
    with pytest.raises(InvalidExpense, match="description est obligatoire"):
        _create(cash_session, cashier, other, description="   ")

    expense = _create(cash_session, cashier, other, description="  Clé du rideau  ")
    assert expense.description == "Clé du rideau"


def test_description_is_optional_otherwise(cash_session, cashier, electricity) -> None:
    expense = _create(cash_session, cashier, electricity, description="")

    assert expense.description == ""


def test_document_reference_is_trimmed_and_bounded(cash_session, cashier, electricity) -> None:
    expense = _create(cash_session, cashier, electricity, document_reference=" SENELEC-0825 ")
    assert expense.document_reference == "SENELEC-0825"

    with pytest.raises(InvalidExpense, match="64 caractères"):
        _create(cash_session, cashier, electricity, document_reference="X" * 65)


# --- Idempotence ------------------------------------------------------------


def test_retry_with_the_same_key_returns_the_same_expense(cash_session, cashier, electricity) -> None:
    key = uuid4()

    first = _create(cash_session, cashier, electricity, idempotency_key=key)
    second = _create(cash_session, cashier, electricity, idempotency_key=key)

    assert second.pk == first.pk
    assert Expense.objects.count() == 1


def test_same_key_with_another_content_is_rejected(cash_session, cashier, electricity) -> None:
    key = uuid4()
    _create(cash_session, cashier, electricity, idempotency_key=key)

    with pytest.raises(InvalidExpense, match="autre dépense"):
        _create(cash_session, cashier, electricity, idempotency_key=key, amount=Decimal("5000"))
    assert Expense.objects.count() == 1


def test_retry_after_the_session_closed_still_returns_the_expense(
    cash_session, cashier, electricity
) -> None:
    """La réponse s'est perdue, la session a été clôturée entre-temps : le
    rejeu ne doit ni échouer ni créer une seconde dépense."""
    key = uuid4()
    first = _create(cash_session, cashier, electricity, payment_method="WAVE", idempotency_key=key)
    close_cash_session(cash_session=cash_session, counted_cash=Decimal("50000"))

    replay = _create(cash_session, cashier, electricity, payment_method="WAVE", idempotency_key=key)

    assert replay.pk == first.pk


# --- Annulation -------------------------------------------------------------


def test_cashier_cancels_own_expense_with_a_reason(cash_session, cashier, electricity) -> None:
    expense = _create(cash_session, cashier, electricity)

    cancelled = cancel_expense(expense=expense, cancelled_by=cashier, reason="  Saisie en double ")

    cancelled.refresh_from_db()
    assert cancelled.status == Expense.Status.CANCELLED
    assert cancelled.cancelled_by == cashier
    assert cancelled.cancelled_at is not None
    assert cancelled.cancellation_reason == "Saisie en double"
    # La ligne reste : on annule, on ne supprime pas.
    assert Expense.objects.count() == 1


def test_cancellation_requires_a_reason(cash_session, cashier, electricity) -> None:
    expense = _create(cash_session, cashier, electricity)

    with pytest.raises(InvalidExpense, match="motif"):
        cancel_expense(expense=expense, cancelled_by=cashier, reason=" ")

    expense.refresh_from_db()
    assert expense.status == Expense.Status.POSTED


def test_double_cancellation_is_rejected(cash_session, cashier, electricity) -> None:
    expense = _create(cash_session, cashier, electricity)
    cancel_expense(expense=expense, cancelled_by=cashier, reason="Erreur")

    with pytest.raises(ExpenseAlreadyCancelled):
        cancel_expense(expense=expense, cancelled_by=cashier, reason="Encore")


def test_cashier_cannot_cancel_a_colleague_expense(cash_session, cashier, electricity) -> None:
    expense = _create(cash_session, cashier, electricity)
    colleague = User.objects.create_user(username="colleague")

    with pytest.raises(ExpenseCancellationNotAllowed):
        cancel_expense(expense=expense, cancelled_by=colleague, reason="Erreur")


def test_staff_can_cancel_any_expense(cash_session, cashier, electricity) -> None:
    expense = _create(cash_session, cashier, electricity)
    manager = User.objects.create_user(username="gerant", is_staff=True)

    cancelled = cancel_expense(expense=expense, cancelled_by=manager, reason="Doublon")

    assert cancelled.status == Expense.Status.CANCELLED
    assert cancelled.cancelled_by == manager


def test_no_cancellation_once_the_session_is_closed(cash_session, cashier, electricity) -> None:
    """Le rapport Z d'une session clôturée ne change jamais après coup,
    même pour le staff."""
    expense = _create(cash_session, cashier, electricity, payment_method="WAVE")
    close_cash_session(cash_session=cash_session, counted_cash=Decimal("50000"))
    manager = User.objects.create_user(username="gerant", is_staff=True)

    with pytest.raises(ExpenseNotCancellable):
        cancel_expense(expense=expense, cancelled_by=manager, reason="Trop tard")


# --- Catégories par défaut --------------------------------------------------


def test_default_categories_exist_and_seeding_is_idempotent() -> None:
    ensure_default_categories()

    assert ensure_default_categories() == 0
    names = list(ExpenseCategory.objects.values_list("name", flat=True))
    assert names == [
        "Électricité",
        "Eau",
        "Transport",
        "Service",
        "Nettoyage",
        "Réparation",
        "Achat divers",
        "Autre",
    ]
    requiring = set(
        ExpenseCategory.objects.filter(requires_description=True).values_list("name", flat=True)
    )
    assert requiring == {"Service", "Réparation", "Achat divers", "Autre"}


def test_seeding_leaves_manager_changes_alone() -> None:
    ensure_default_categories()
    ExpenseCategory.objects.filter(name="Eau").update(is_active=False, requires_description=True)

    ensure_default_categories()

    water = ExpenseCategory.objects.get(name="Eau")
    assert water.is_active is False
    assert water.requires_description is True
