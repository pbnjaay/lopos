from decimal import Decimal
from threading import Barrier

import pytest
from django.contrib.auth import get_user_model
from django.db import close_old_connections, connection, connections

from apps.cash.exceptions import CashSessionClosed
from apps.cash.models import CashSession
from apps.cash.services import close_cash_session, get_cash_session_summary
from apps.catalog.models import Product
from apps.inventory.models import InventoryMovement, Stock
from apps.sales.models import Payment, Sale, SaleItem
from apps.sales.services import complete_sale
from apps.stores.models import CashRegister, Store


User = get_user_model()


def _attempt_sale(*, cash_session_id, product_id, start_barrier: Barrier) -> str:
    close_old_connections()
    try:
        cash_session = CashSession.objects.get(pk=cash_session_id)
        start_barrier.wait(timeout=10)
        try:
            complete_sale(
                cash_session=cash_session,
                items=[{"product_id": product_id, "quantity": 1}],
                payment_method=Payment.Method.CASH,
                received_amount=Decimal("500.00"),
            )
        except CashSessionClosed:
            return "rejected_closed"
        return "completed"
    finally:
        connections["default"].close()


def _attempt_close(*, cash_session_id, start_barrier: Barrier) -> str:
    close_old_connections()
    try:
        cash_session = CashSession.objects.get(pk=cash_session_id)
        start_barrier.wait(timeout=10)
        close_cash_session(cash_session=cash_session, counted_cash=Decimal("15000.00"))
        return "closed"
    finally:
        connections["default"].close()


@pytest.mark.django_db(transaction=True)
def test_sale_and_close_serialize_without_losing_either_side() -> None:
    """
    complete_sale() and close_cash_session() both take
    SELECT ... FOR UPDATE on the same CashSession row before doing
    anything else. PostgreSQL forces whichever transaction arrives
    second to wait until the first commits (or rolls back), so the two
    operations can never interleave: either the sale commits first and
    is therefore included in the totals close_cash_session() reads
    afterwards, or the close commits first, flips status to CLOSED,
    and the sale then observes CLOSED and is rejected. No third
    outcome (a COMPLETED sale invisible to the close, or a sale
    created after CLOSED) is reachable without mocking anything.
    """
    from concurrent.futures import ThreadPoolExecutor

    assert connection.vendor == "postgresql"

    store = Store.objects.create(name="Supérette Test")
    product = Product.objects.create(name="Coca 50cl", selling_price=Decimal("500.00"))
    Stock.objects.create(store=store, product=product, quantity=100)

    cashier = User.objects.create_user(username="cashier")
    register = CashRegister.objects.create(store=store, name="Caisse 01")
    cash_session = CashSession.objects.create(
        cash_register=register,
        cashier=cashier,
        opening_balance=Decimal("15000.00"),
    )

    start_barrier = Barrier(2)
    with ThreadPoolExecutor(max_workers=2) as executor:
        sale_future = executor.submit(
            _attempt_sale,
            cash_session_id=cash_session.id,
            product_id=product.id,
            start_barrier=start_barrier,
        )
        close_future = executor.submit(
            _attempt_close,
            cash_session_id=cash_session.id,
            start_barrier=start_barrier,
        )
        sale_result = sale_future.result(timeout=15)
        close_result = close_future.result(timeout=15)

    assert close_result == "closed"
    cash_session.refresh_from_db()
    assert cash_session.status == CashSession.Status.CLOSED

    summary = get_cash_session_summary(cash_session=cash_session)

    if sale_result == "completed":
        # The sale committed before the close locked the row: it must
        # be visible in the persisted totals the close computed.
        assert Sale.objects.count() == 1
        assert cash_session.expected_balance == Decimal("15500.00")
        assert summary.sales_count == 1
        assert summary.cash_sales == Decimal("500.00")
        assert Sale.objects.get().created_at <= cash_session.closed_at
    else:
        # The close won the race: the sale must have been rejected
        # and left no trace whatsoever.
        assert sale_result == "rejected_closed"
        assert cash_session.expected_balance == Decimal("15000.00")
        assert Sale.objects.count() == 0
        assert SaleItem.objects.count() == 0
        assert Payment.objects.count() == 0
        assert InventoryMovement.objects.count() == 0
        assert summary.sales_count == 0

    # Whichever ordering happened, no sale can exist that the closed
    # session's own summary fails to account for.
    assert Sale.objects.filter(status=Sale.Status.COMPLETED).count() == summary.sales_count
    assert not Sale.objects.filter(created_at__gt=cash_session.closed_at).exists()
