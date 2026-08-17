from decimal import Decimal
from unittest.mock import patch
from uuid import uuid4

import pytest
from django.contrib.auth import get_user_model

from apps.cash.exceptions import CashSessionClosed
from apps.cash.models import CashSession
from apps.catalog.models import Product
from apps.inventory.models import InventoryMovement, Stock
from apps.sales.exceptions import (
    InsufficientStock,
    InvalidPayment,
    InvalidSaleItems,
    ProductInactive,
    ProductNotFound,
)
from apps.sales.models import Payment, Sale, SaleItem
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
def cash_session(store: Store, cashier) -> CashSession:
    register = CashRegister.objects.create(store=store, name="Caisse 01")
    return CashSession.objects.create(
        cash_register=register,
        cashier=cashier,
        opening_balance=Decimal("15000.00"),
    )


def create_product_with_stock(
    *,
    store: Store,
    name: str,
    price: Decimal,
    quantity: int,
) -> tuple[Product, Stock]:
    product = Product.objects.create(name=name, selling_price=price)
    stock = Stock.objects.create(store=store, product=product, quantity=quantity)
    return product, stock


def test_complete_sale_decrements_stock_and_creates_audit_records(
    store: Store,
    cash_session: CashSession,
) -> None:
    product, stock = create_product_with_stock(
        store=store,
        name="Coca 50cl",
        price=Decimal("500.00"),
        quantity=20,
    )

    sale = complete_sale(
        cash_session=cash_session,
        items=[{"product_id": product.id, "quantity": 2}],
        payment_method=Payment.Method.CASH,
        received_amount=Decimal("2000.00"),
    )

    stock.refresh_from_db()
    item = SaleItem.objects.get(sale=sale)
    payment = Payment.objects.get(sale=sale)
    movement = InventoryMovement.objects.get(movement_type=InventoryMovement.Type.SALE)

    assert sale.status == Sale.Status.COMPLETED
    assert sale.cashier == cash_session.cashier
    assert sale.subtotal == Decimal("1000.00")
    assert sale.discount == Decimal("0.00")
    assert sale.total == Decimal("1000.00")
    assert item.product_name == "Coca 50cl"
    assert item.unit_price == Decimal("500.00")
    assert item.quantity == 2
    assert item.line_total == Decimal("1000.00")
    assert payment.amount == Decimal("1000.00")
    assert payment.received_amount == Decimal("2000.00")
    assert payment.change_amount == Decimal("1000.00")
    assert stock.quantity == 18
    assert movement.quantity == -2
    assert movement.reference == sale.id


def test_complete_sale_handles_multiple_products(
    store: Store,
    cash_session: CashSession,
) -> None:
    coca, coca_stock = create_product_with_stock(
        store=store,
        name="Coca 50cl",
        price=Decimal("500.00"),
        quantity=20,
    )
    bread, bread_stock = create_product_with_stock(
        store=store,
        name="Pain",
        price=Decimal("200.00"),
        quantity=10,
    )

    sale = complete_sale(
        cash_session=cash_session,
        items=[
            {"product_id": coca.id, "quantity": 2},
            {"product_id": bread.id, "quantity": 1},
        ],
        payment_method=Payment.Method.WAVE,
    )

    coca_stock.refresh_from_db()
    bread_stock.refresh_from_db()
    payment = Payment.objects.get(sale=sale)

    assert sale.total == Decimal("1200.00")
    assert coca_stock.quantity == 18
    assert bread_stock.quantity == 9
    assert SaleItem.objects.filter(sale=sale).count() == 2
    assert InventoryMovement.objects.filter(
        movement_type=InventoryMovement.Type.SALE,
        reference=sale.id,
    ).count() == 2
    assert payment.received_amount is None
    assert payment.change_amount is None


def test_complete_sale_aggregates_duplicate_product_lines(
    store: Store,
    cash_session: CashSession,
) -> None:
    product, stock = create_product_with_stock(
        store=store,
        name="Coca 50cl",
        price=Decimal("500.00"),
        quantity=3,
    )

    sale = complete_sale(
        cash_session=cash_session,
        items=[
            {"product_id": product.id, "quantity": 1},
            {"product_id": product.id, "quantity": 2},
        ],
        payment_method=Payment.Method.ORANGE_MONEY,
    )

    stock.refresh_from_db()
    item = SaleItem.objects.get(sale=sale)
    assert item.quantity == 3
    assert sale.total == Decimal("1500.00")
    assert stock.quantity == 0


def test_complete_sale_rejects_insufficient_cash_without_side_effects(
    store: Store,
    cash_session: CashSession,
) -> None:
    product, stock = create_product_with_stock(
        store=store,
        name="Coca 50cl",
        price=Decimal("500.00"),
        quantity=20,
    )

    with pytest.raises(InvalidPayment):
        complete_sale(
            cash_session=cash_session,
            items=[{"product_id": product.id, "quantity": 2}],
            payment_method=Payment.Method.CASH,
            received_amount=Decimal("500.00"),
        )

    stock.refresh_from_db()
    assert stock.quantity == 20
    assert Sale.objects.count() == 0
    assert Payment.objects.count() == 0
    assert InventoryMovement.objects.count() == 0


def test_complete_sale_rejects_insufficient_stock_without_side_effects(
    store: Store,
    cash_session: CashSession,
) -> None:
    product, stock = create_product_with_stock(
        store=store,
        name="Coca 50cl",
        price=Decimal("500.00"),
        quantity=1,
    )

    with pytest.raises(InsufficientStock) as exc_info:
        complete_sale(
            cash_session=cash_session,
            items=[{"product_id": product.id, "quantity": 2}],
            payment_method=Payment.Method.CASH,
            received_amount=Decimal("2000.00"),
        )

    stock.refresh_from_db()
    assert exc_info.value.available == 1
    assert exc_info.value.requested == 2
    assert stock.quantity == 1
    assert Sale.objects.count() == 0
    assert InventoryMovement.objects.count() == 0


def test_complete_sale_rejects_closed_session(
    store: Store,
    cash_session: CashSession,
) -> None:
    product, stock = create_product_with_stock(
        store=store,
        name="Coca 50cl",
        price=Decimal("500.00"),
        quantity=20,
    )
    cash_session.status = CashSession.Status.CLOSED
    cash_session.save(update_fields=("status",))

    with pytest.raises(CashSessionClosed):
        complete_sale(
            cash_session=cash_session,
            items=[{"product_id": product.id, "quantity": 2}],
            payment_method=Payment.Method.WAVE,
        )

    stock.refresh_from_db()
    assert stock.quantity == 20
    assert Sale.objects.count() == 0


def test_complete_sale_rejects_inactive_product(
    store: Store,
    cash_session: CashSession,
) -> None:
    product, stock = create_product_with_stock(
        store=store,
        name="Coca 50cl",
        price=Decimal("500.00"),
        quantity=20,
    )
    product.is_active = False
    product.save(update_fields=("is_active",))

    with pytest.raises(ProductInactive):
        complete_sale(
            cash_session=cash_session,
            items=[{"product_id": product.id, "quantity": 2}],
            payment_method=Payment.Method.WAVE,
        )

    stock.refresh_from_db()
    assert stock.quantity == 20
    assert Sale.objects.count() == 0


def test_complete_sale_rejects_empty_or_invalid_items(
    cash_session: CashSession,
) -> None:
    with pytest.raises(InvalidSaleItems):
        complete_sale(
            cash_session=cash_session,
            items=[],
            payment_method=Payment.Method.WAVE,
        )


def test_complete_sale_rejects_unknown_product(
    cash_session: CashSession,
) -> None:
    unknown_product_id = uuid4()

    with pytest.raises(ProductNotFound) as exc_info:
        complete_sale(
            cash_session=cash_session,
            items=[{"product_id": unknown_product_id, "quantity": 1}],
            payment_method=Payment.Method.WAVE,
        )

    assert exc_info.value.product_id == unknown_product_id
    assert Sale.objects.count() == 0


def test_complete_sale_rejects_received_amount_for_mobile_payment(
    store: Store,
    cash_session: CashSession,
) -> None:
    product, stock = create_product_with_stock(
        store=store,
        name="Coca 50cl",
        price=Decimal("500.00"),
        quantity=20,
    )

    with pytest.raises(InvalidPayment):
        complete_sale(
            cash_session=cash_session,
            items=[{"product_id": product.id, "quantity": 1}],
            payment_method=Payment.Method.WAVE,
            received_amount=Decimal("500.00"),
        )

    stock.refresh_from_db()
    assert stock.quantity == 20
    assert Sale.objects.count() == 0


def test_complete_sale_rolls_back_everything_on_late_failure(
    store: Store,
    cash_session: CashSession,
) -> None:
    product, stock = create_product_with_stock(
        store=store,
        name="Coca 50cl",
        price=Decimal("500.00"),
        quantity=20,
    )

    with (
        patch.object(
            InventoryMovement.objects,
            "bulk_create",
            side_effect=RuntimeError("forced inventory failure"),
        ),
        pytest.raises(RuntimeError, match="forced inventory failure"),
    ):
        complete_sale(
            cash_session=cash_session,
            items=[{"product_id": product.id, "quantity": 2}],
            payment_method=Payment.Method.CASH,
            received_amount=Decimal("2000.00"),
        )

    stock.refresh_from_db()
    assert stock.quantity == 20
    assert Sale.objects.count() == 0
    assert SaleItem.objects.count() == 0
    assert Payment.objects.count() == 0
    assert InventoryMovement.objects.count() == 0
