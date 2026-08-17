from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction

from apps.cash.models import CashSession
from apps.stores.models import CashRegister, Store


pytestmark = pytest.mark.django_db
User = get_user_model()


@pytest.fixture
def cashier():
    return User.objects.create_user(username="cashier")


@pytest.fixture
def cash_register() -> CashRegister:
    store = Store.objects.create(name="Supérette Test")
    return CashRegister.objects.create(store=store, name="Caisse 01")


def test_database_allows_only_one_open_session_per_register(
    cash_register: CashRegister,
    cashier,
) -> None:
    CashSession.objects.create(
        cash_register=cash_register,
        cashier=cashier,
        opening_balance=Decimal("15000.00"),
    )

    with pytest.raises(IntegrityError), transaction.atomic():
        CashSession.objects.create(
            cash_register=cash_register,
            cashier=cashier,
            opening_balance=Decimal("10000.00"),
        )


def test_database_allows_a_new_open_session_after_closure(
    cash_register: CashRegister,
    cashier,
) -> None:
    CashSession.objects.create(
        cash_register=cash_register,
        cashier=cashier,
        opening_balance=Decimal("15000.00"),
        status=CashSession.Status.CLOSED,
    )

    current = CashSession.objects.create(
        cash_register=cash_register,
        cashier=cashier,
        opening_balance=Decimal("10000.00"),
    )

    assert current.status == CashSession.Status.OPEN


def test_database_rejects_negative_opening_balance(
    cash_register: CashRegister,
    cashier,
) -> None:
    with pytest.raises(IntegrityError), transaction.atomic():
        CashSession.objects.create(
            cash_register=cash_register,
            cashier=cashier,
            opening_balance=Decimal("-0.01"),
        )
