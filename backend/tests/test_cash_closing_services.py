from decimal import Decimal
from unittest.mock import patch

import pytest
from django.contrib.auth import get_user_model

from apps.cash.exceptions import CashSessionAlreadyClosed, InvalidCountedCash
from apps.cash.models import CashSession
from apps.cash.services import close_cash_session, get_cash_session_summary
from apps.catalog.models import Product
from apps.inventory.models import InventoryMovement, Stock
from apps.sales.models import Payment, SaleItem
from apps.sales.services import complete_sale
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
def cash_register(store: Store) -> CashRegister:
    return CashRegister.objects.create(store=store, name="Caisse 01")


@pytest.fixture
def cash_session(cash_register: CashRegister, cashier) -> CashSession:
    return CashSession.objects.create(
        cash_register=cash_register,
        cashier=cashier,
        opening_balance=Decimal("15000.00"),
    )


def _sell(
    *,
    store: Store,
    cash_session: CashSession,
    price: Decimal,
    quantity: int,
    method: str,
    name: str,
) -> None:
    product = Product.objects.create(name=name, selling_price=price)
    Stock.objects.create(store=store, product=product, quantity=quantity)
    received = price * quantity if method == Payment.Method.CASH else None
    complete_sale(
        cash_session=cash_session,
        items=[{"product_id": product.id, "quantity": quantity}],
        payment_method=method,
        received_amount=received,
    )


def test_summary_aggregates_sales_by_payment_method(
    store: Store,
    cash_session: CashSession,
) -> None:
    _sell(
        store=store,
        cash_session=cash_session,
        price=Decimal("10000.00"),
        quantity=1,
        method=Payment.Method.CASH,
        name="Sac de riz",
    )
    _sell(
        store=store,
        cash_session=cash_session,
        price=Decimal("5000.00"),
        quantity=1,
        method=Payment.Method.CASH,
        name="Huile",
    )
    _sell(
        store=store,
        cash_session=cash_session,
        price=Decimal("20000.00"),
        quantity=1,
        method=Payment.Method.WAVE,
        name="Sucre",
    )
    _sell(
        store=store,
        cash_session=cash_session,
        price=Decimal("8000.00"),
        quantity=1,
        method=Payment.Method.ORANGE_MONEY,
        name="Savon",
    )

    summary = get_cash_session_summary(cash_session=cash_session)

    assert summary.sales_count == 4
    assert summary.gross_sales == Decimal("43000.00")
    assert summary.cash_sales == Decimal("15000.00")
    assert summary.wave_sales == Decimal("20000.00")
    assert summary.orange_money_sales == Decimal("8000.00")
    assert summary.opening_balance == Decimal("15000.00")
    assert summary.expected_cash == Decimal("30000.00")
    assert summary.counted_cash is None
    assert summary.cash_difference is None
    assert summary.closed_at is None


def test_summary_on_session_with_no_sales(cash_session: CashSession) -> None:
    summary = get_cash_session_summary(cash_session=cash_session)

    assert summary.sales_count == 0
    assert summary.gross_sales == Decimal("0.00")
    assert summary.cash_sales == Decimal("0.00")
    assert summary.wave_sales == Decimal("0.00")
    assert summary.orange_money_sales == Decimal("0.00")
    assert summary.expected_cash == Decimal("15000.00")


def test_summary_ignores_cancelled_sales(
    store: Store,
    cash_session: CashSession,
) -> None:
    _sell(
        store=store,
        cash_session=cash_session,
        price=Decimal("10000.00"),
        quantity=1,
        method=Payment.Method.CASH,
        name="Sac de riz",
    )
    from apps.sales.models import Sale

    Sale.objects.update(status=Sale.Status.CANCELLED)

    summary = get_cash_session_summary(cash_session=cash_session)

    assert summary.sales_count == 0
    assert summary.gross_sales == Decimal("0.00")
    assert summary.cash_sales == Decimal("0.00")


def _seed_reference_scenario(store: Store, cash_session: CashSession) -> None:
    _sell(
        store=store,
        cash_session=cash_session,
        price=Decimal("15000.00"),
        quantity=1,
        method=Payment.Method.CASH,
        name="Sac de riz",
    )
    _sell(
        store=store,
        cash_session=cash_session,
        price=Decimal("20000.00"),
        quantity=1,
        method=Payment.Method.WAVE,
        name="Sucre",
    )
    _sell(
        store=store,
        cash_session=cash_session,
        price=Decimal("8000.00"),
        quantity=1,
        method=Payment.Method.ORANGE_MONEY,
        name="Savon",
    )


def test_close_cash_session_with_shortage(
    store: Store,
    cash_session: CashSession,
) -> None:
    _seed_reference_scenario(store, cash_session)

    closed = close_cash_session(cash_session=cash_session, counted_cash=Decimal("29500.00"))

    assert closed.status == CashSession.Status.CLOSED
    assert closed.expected_balance == Decimal("30000.00")
    assert closed.closing_balance == Decimal("29500.00")
    assert closed.difference == Decimal("-500.00")
    assert closed.closed_at is not None


def test_close_cash_session_exact(
    store: Store,
    cash_session: CashSession,
) -> None:
    _seed_reference_scenario(store, cash_session)

    closed = close_cash_session(cash_session=cash_session, counted_cash=Decimal("30000.00"))

    assert closed.difference == Decimal("0.00")


def test_close_cash_session_with_surplus(
    store: Store,
    cash_session: CashSession,
) -> None:
    _seed_reference_scenario(store, cash_session)

    closed = close_cash_session(cash_session=cash_session, counted_cash=Decimal("31000.00"))

    assert closed.difference == Decimal("1000.00")


def test_close_cash_session_rejects_negative_counted_cash(
    cash_session: CashSession,
) -> None:
    with pytest.raises(InvalidCountedCash):
        close_cash_session(cash_session=cash_session, counted_cash=Decimal("-1"))

    cash_session.refresh_from_db()
    assert cash_session.status == CashSession.Status.OPEN
    assert cash_session.closed_at is None


def test_close_cash_session_rejects_double_closing(
    cash_session: CashSession,
) -> None:
    close_cash_session(cash_session=cash_session, counted_cash=Decimal("15000.00"))

    with pytest.raises(CashSessionAlreadyClosed):
        close_cash_session(cash_session=cash_session, counted_cash=Decimal("15000.00"))


def test_sale_after_close_is_rejected(
    store: Store,
    cash_session: CashSession,
) -> None:
    from apps.cash.exceptions import CashSessionClosed
    from apps.sales.models import Sale

    close_cash_session(cash_session=cash_session, counted_cash=Decimal("15000.00"))

    product = Product.objects.create(name="Coca 50cl", selling_price=Decimal("500.00"))
    Stock.objects.create(store=store, product=product, quantity=10)

    with pytest.raises(CashSessionClosed):
        complete_sale(
            cash_session=cash_session,
            items=[{"product_id": product.id, "quantity": 1}],
            payment_method=Payment.Method.WAVE,
        )

    assert Sale.objects.count() == 0
    assert SaleItem.objects.count() == 0
    assert Payment.objects.count() == 0
    assert not InventoryMovement.objects.filter(
        movement_type=InventoryMovement.Type.SALE
    ).exists()


def test_close_cash_session_rolls_back_on_late_failure(
    store: Store,
    cash_session: CashSession,
) -> None:
    _seed_reference_scenario(store, cash_session)

    with patch(
        "apps.cash.models.CashSession.save",
        side_effect=RuntimeError("boom"),
    ):
        with pytest.raises(RuntimeError):
            close_cash_session(cash_session=cash_session, counted_cash=Decimal("30000.00"))

    cash_session.refresh_from_db()
    assert cash_session.status == CashSession.Status.OPEN
    assert cash_session.closed_at is None
    assert cash_session.closing_balance is None
    assert cash_session.expected_balance is None
    assert cash_session.difference is None
