from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from threading import Barrier
from uuid import uuid4

import pytest
from django.contrib.auth import get_user_model
from django.db import close_old_connections, connection

from apps.cash.models import CashSession
from apps.catalog.models import Product
from apps.inventory.models import Stock
from apps.sales.exceptions import InvalidReturn
from apps.sales.models import Payment, Sale, SaleItem, SaleReturn
from apps.sales.services import create_sale_return
from apps.stores.models import CashRegister, Store

User = get_user_model()


def _attempt_return(*, sale_id, item_id, session_id, user_id, barrier):
    close_old_connections()
    try:
        barrier.wait(timeout=10)
        create_sale_return(
            original_sale=Sale.objects.get(pk=sale_id),
            cash_session=CashSession.objects.get(pk=session_id),
            created_by=User.objects.get(pk=user_id),
            payment_method=Payment.Method.CASH,
            idempotency_key=uuid4(),
            items=[{"sale_item_id": item_id, "quantity": Decimal("1"), "restock": True}],
        )
        return "created"
    except InvalidReturn:
        return "rejected"
    finally:
        close_old_connections()


@pytest.mark.django_db(transaction=True)
def test_two_terminals_cannot_return_the_same_quantity_twice():
    assert connection.vendor == "postgresql"
    store = Store.objects.create(name="Concurrence retours")
    product = Product.objects.create(name="Coca", selling_price=Decimal("500"))
    Stock.objects.create(store=store, product=product, quantity=Decimal("9.000"))
    users = [User.objects.create_user(username=f"return-{index}") for index in range(2)]
    sessions = [
        CashSession.objects.create(
            cash_register=CashRegister.objects.create(store=store, name=f"Caisse {index}"),
            cashier=user, opening_balance=Decimal("10000"),
        )
        for index, user in enumerate(users)
    ]
    sale = Sale.objects.create(
        cash_session=sessions[0], cashier=users[0], subtotal=Decimal("500"),
        discount=Decimal("0"), total=Decimal("500"), status=Sale.Status.COMPLETED,
    )
    item = SaleItem.objects.create(
        sale=sale, product=product, product_name=product.name,
        catalog_unit_price=Decimal("500"), unit_price=Decimal("500"),
        quantity=Decimal("1.000"), line_total=Decimal("500"),
    )

    barrier = Barrier(2)
    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [
            executor.submit(
                _attempt_return, sale_id=sale.id, item_id=item.id,
                session_id=session.id, user_id=user.id, barrier=barrier,
            )
            for session, user in zip(sessions, users, strict=True)
        ]
        results = [future.result(timeout=15) for future in futures]

    assert sorted(results) == ["created", "rejected"]
    assert SaleReturn.objects.count() == 1
    assert Stock.objects.get(store=store, product=product).quantity == Decimal("10.000")
