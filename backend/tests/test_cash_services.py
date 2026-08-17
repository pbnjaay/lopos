from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model

from apps.cash.exceptions import (
    CashRegisterInactive,
    CashSessionAlreadyOpen,
    InvalidOpeningBalance,
)
from apps.cash.models import CashSession
from apps.cash.services import open_cash_session
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


def test_open_cash_session(
    cash_register: CashRegister,
    cashier,
) -> None:
    session = open_cash_session(
        cash_register=cash_register,
        cashier=cashier,
        opening_balance=Decimal("15000.00"),
    )

    assert session.status == CashSession.Status.OPEN
    assert session.opening_balance == Decimal("15000.00")
    assert session.cash_register == cash_register
    assert session.cashier == cashier
    assert session.opened_at is not None


def test_open_cash_session_rejects_second_opening(
    cash_register: CashRegister,
    cashier,
) -> None:
    open_cash_session(
        cash_register=cash_register,
        cashier=cashier,
        opening_balance=Decimal("15000.00"),
    )

    with pytest.raises(CashSessionAlreadyOpen):
        open_cash_session(
            cash_register=cash_register,
            cashier=cashier,
            opening_balance=Decimal("10000.00"),
        )

    assert CashSession.objects.count() == 1


@pytest.mark.parametrize("opening_balance", [Decimal("-1"), True, 15000.0])
def test_open_cash_session_rejects_invalid_balance(
    cash_register: CashRegister,
    cashier,
    opening_balance,
) -> None:
    with pytest.raises(InvalidOpeningBalance):
        open_cash_session(
            cash_register=cash_register,
            cashier=cashier,
            opening_balance=opening_balance,
        )

    assert CashSession.objects.count() == 0


def test_open_cash_session_rejects_inactive_register(
    cash_register: CashRegister,
    cashier,
) -> None:
    cash_register.is_active = False
    cash_register.save(update_fields=("is_active",))

    with pytest.raises(CashRegisterInactive):
        open_cash_session(
            cash_register=cash_register,
            cashier=cashier,
            opening_balance=Decimal("15000.00"),
        )

    assert CashSession.objects.count() == 0
