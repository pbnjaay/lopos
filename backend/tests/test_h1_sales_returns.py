from decimal import Decimal
from uuid import uuid4
from django.utils import timezone

import pytest
from django.contrib.auth import get_user_model

from apps.cash.models import CashSession
from apps.cash.services import get_cash_session_summary
from apps.catalog.models import Product
from apps.inventory.models import InventoryMovement, Stock
from apps.sales.exceptions import InvalidReturn, InvalidSaleItems
from apps.sales.models import Payment, SaleItem, SaleReturn
from apps.sales.services import complete_sale, complete_offline_sale, create_sale_return
from apps.stores.models import CashRegister, Store

pytestmark = pytest.mark.django_db


@pytest.fixture
def context():
    cashier = get_user_model().objects.create_user(username="h1-cashier")
    store = Store.objects.create(name="Pilote H1")
    register = CashRegister.objects.create(store=store, name="Caisse 01")
    session = CashSession.objects.create(
        cash_register=register, cashier=cashier, opening_balance=Decimal("10000.00")
    )
    return cashier, store, session


def test_unit_product_rejects_fractional_quantity(context):
    _, store, session = context
    product = Product.objects.create(name="Coca", selling_price=Decimal("500"))
    Stock.objects.create(store=store, product=product, quantity=Decimal("10.000"))
    with pytest.raises(InvalidSaleItems):
        complete_sale(
            cash_session=session,
            items=[{"product_id": product.id, "quantity": Decimal("0.500")}],
            payment_method=Payment.Method.WAVE,
        )


def test_kg_override_and_partial_return_are_exact(context):
    cashier, store, session = context
    product = Product.objects.create(
        name="Banane", selling_price=Decimal("1000"), sale_unit=Product.SaleUnit.KG
    )
    stock = Stock.objects.create(store=store, product=product, quantity=Decimal("5.000"))
    sale = complete_sale(
        cash_session=session,
        items=[{
            "product_id": product.id,
            "quantity": Decimal("0.500"),
            "unit_price": Decimal("900"),
        }],
        payment_method=Payment.Method.CASH,
        received_amount=Decimal("1000"),
    )
    item = SaleItem.objects.get(sale=sale)
    stock.refresh_from_db()
    assert sale.total == Decimal("450.00")
    assert item.catalog_unit_price == Decimal("1000.00")
    assert item.unit_price == Decimal("900.00")
    assert stock.quantity == Decimal("4.500")
    assert InventoryMovement.objects.get(movement_type="SALE").quantity == Decimal("-0.500")

    returned = create_sale_return(
        original_sale=sale,
        cash_session=session,
        created_by=cashier,
        payment_method=Payment.Method.CASH,
        idempotency_key=uuid4(),
        items=[{"sale_item_id": item.id, "quantity": Decimal("0.200"), "restock": True}],
    )
    stock.refresh_from_db()
    item.refresh_from_db()
    assert returned.total_refund == Decimal("180.00")
    assert stock.quantity == Decimal("4.700")
    assert item.quantity_returnable == Decimal("0.300")
    assert InventoryMovement.objects.get(movement_type="RETURN_IN").quantity == Decimal("0.200")
    sale.refresh_from_db()
    assert sale.total == Decimal("450.00")
    assert item.quantity == Decimal("0.500")


def test_return_is_idempotent_and_prevents_over_return(context):
    cashier, store, session = context
    product = Product.objects.create(name="Coca", selling_price=Decimal("500"))
    stock = Stock.objects.create(store=store, product=product, quantity=Decimal("5.000"))
    sale = complete_sale(
        cash_session=session,
        items=[{"product_id": product.id, "quantity": Decimal("2")}],
        payment_method=Payment.Method.WAVE,
    )
    item = sale.items.get()
    key = uuid4()
    kwargs = dict(
        original_sale=sale, cash_session=session, created_by=cashier,
        payment_method=Payment.Method.WAVE, idempotency_key=key,
        items=[{"sale_item_id": item.id, "quantity": Decimal("1"), "restock": False}],
    )
    first = create_sale_return(**kwargs)
    assert create_sale_return(**kwargs).id == first.id
    assert SaleReturn.objects.count() == 1

    # restock=False : le retour est tracé par SaleReturnItem, sans créer de
    # faux mouvement ni modifier le stock disponible.
    stock.refresh_from_db()
    assert stock.quantity == Decimal("3.000")
    assert not InventoryMovement.objects.filter(movement_type="RETURN_IN").exists()
    with pytest.raises(InvalidReturn):
        create_sale_return(**{**kwargs, "idempotency_key": uuid4(), "items": [{"sale_item_id": item.id, "quantity": Decimal("2"), "restock": False}]})


def test_cash_summary_subtracts_cash_refunds(context):
    cashier, store, session = context
    product = Product.objects.create(name="Coca", selling_price=Decimal("500"))
    Stock.objects.create(store=store, product=product, quantity=Decimal("10.000"))
    sale = complete_sale(
        cash_session=session,
        items=[{"product_id": product.id, "quantity": Decimal("4")}],
        payment_method=Payment.Method.CASH,
        received_amount=Decimal("2000"),
    )
    create_sale_return(
        original_sale=sale, cash_session=session, created_by=cashier,
        payment_method=Payment.Method.CASH, idempotency_key=uuid4(),
        items=[{"sale_item_id": sale.items.get().id, "quantity": Decimal("1"), "restock": True}],
    )
    summary = get_cash_session_summary(cash_session=session)
    assert summary.gross_sales == Decimal("2000.00")
    assert summary.returns_total == Decimal("500.00")
    assert summary.net_sales == Decimal("1500.00")
    assert summary.expected_cash == Decimal("11500.00")


def test_offline_override_keeps_historical_catalog_snapshot(context):
    _, store, session = context
    product = Product.objects.create(
        name="Banane", selling_price=Decimal("1200"), sale_unit=Product.SaleUnit.KG
    )
    Stock.objects.create(store=store, product=product, quantity=Decimal("2.000"))
    sale, _ = complete_offline_sale(
        sale_id=uuid4(), cash_session=session, occurred_at=timezone.now(),
        payment_method=Payment.Method.WAVE, received_amount=None,
        items=[{
            "product_id": product.id, "product_name": "Banane",
            "quantity": Decimal("0.300"), "unit_price": Decimal("900"),
            "catalog_unit_price": Decimal("1000"),
        }],
    )
    item = sale.items.get()
    assert item.catalog_unit_price == Decimal("1000.00")
    assert item.unit_price == Decimal("900.00")
    assert item.line_total == Decimal("270.00")
