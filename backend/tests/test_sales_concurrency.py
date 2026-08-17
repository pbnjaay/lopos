from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from threading import Barrier

import pytest
from django.contrib.auth import get_user_model
from django.db import close_old_connections, connection, connections

from apps.cash.models import CashSession
from apps.catalog.models import Product
from apps.inventory.models import InventoryMovement, Stock
from apps.sales.exceptions import InsufficientStock
from apps.sales.models import Payment, Sale, SaleItem
from apps.sales.services import complete_sale
from apps.stores.models import CashRegister, Store


User = get_user_model()


def _attempt_sale(
    *,
    cash_session_id,
    product_id,
    start_barrier: Barrier,
) -> str:
    close_old_connections()
    try:
        cash_session = CashSession.objects.get(pk=cash_session_id)
        start_barrier.wait(timeout=10)
        try:
            complete_sale(
                cash_session=cash_session,
                items=[{"product_id": product_id, "quantity": 1}],
                payment_method=Payment.Method.WAVE,
            )
        except InsufficientStock:
            return "insufficient_stock"
        return "completed"
    finally:
        connections["default"].close()


@pytest.mark.django_db(transaction=True)
def test_two_concurrent_sales_cannot_make_stock_negative() -> None:
    assert connection.vendor == "postgresql"

    store = Store.objects.create(name="Supérette Test")
    product = Product.objects.create(
        name="Coca 50cl",
        selling_price=Decimal("500.00"),
    )
    stock = Stock.objects.create(store=store, product=product, quantity=1)

    first_cashier = User.objects.create_user(username="cashier-a")
    second_cashier = User.objects.create_user(username="cashier-b")
    first_register = CashRegister.objects.create(store=store, name="Caisse A")
    second_register = CashRegister.objects.create(store=store, name="Caisse B")
    first_session = CashSession.objects.create(
        cash_register=first_register,
        cashier=first_cashier,
        opening_balance=Decimal("15000.00"),
    )
    second_session = CashSession.objects.create(
        cash_register=second_register,
        cashier=second_cashier,
        opening_balance=Decimal("15000.00"),
    )

    start_barrier = Barrier(2)
    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [
            executor.submit(
                _attempt_sale,
                cash_session_id=cash_session_id,
                product_id=product.id,
                start_barrier=start_barrier,
            )
            for cash_session_id in (first_session.id, second_session.id)
        ]
        results = [future.result(timeout=15) for future in futures]

    stock.refresh_from_db()
    assert sorted(results) == ["completed", "insufficient_stock"]
    assert stock.quantity == 0
    assert Sale.objects.count() == 1
    assert SaleItem.objects.count() == 1
    assert Payment.objects.count() == 1
    assert InventoryMovement.objects.filter(
        movement_type=InventoryMovement.Type.SALE,
        quantity=-1,
    ).count() == 1
    assert not Stock.objects.filter(quantity__lt=0).exists()
