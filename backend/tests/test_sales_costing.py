from decimal import Decimal
from uuid import uuid4

import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone

from apps.cash.models import CashSession
from apps.catalog.models import Product
from apps.inventory.models import InventoryMovement, Stock
from apps.inventory.services import receive_stock
from apps.sales.models import Payment, Sale
from apps.sales.services import cancel_sale, complete_offline_sale, complete_sale
from apps.stores.models import CashRegister, Store


pytestmark = pytest.mark.django_db
User = get_user_model()


@pytest.fixture
def cashier():
    return User.objects.create_user(username="cashier", password="secret")


@pytest.fixture
def store() -> Store:
    return Store.objects.create(name="Supérette Test")


@pytest.fixture
def cash_session(store: Store, cashier) -> CashSession:
    register = CashRegister.objects.create(store=store, name="Caisse 01")
    return CashSession.objects.create(
        cash_register=register, cashier=cashier, opening_balance=Decimal("15000.00")
    )


@pytest.fixture
def product(store: Store) -> Product:
    product = Product.objects.create(name="Coca 50cl", selling_price=Decimal("500.00"))
    Stock.objects.create(
        store=store, product=product, quantity=20, average_unit_cost=Decimal("300")
    )
    return product


def _sell(cash_session: CashSession, product: Product, quantity, unit_price=None) -> Sale:
    price = unit_price if unit_price is not None else product.selling_price
    amount = (price * Decimal(quantity)).quantize(Decimal("0.01"))
    return complete_sale(
        cash_session=cash_session,
        items=[{"product_id": product.id, "quantity": Decimal(quantity), "unit_price": unit_price}],
        payments=[{"method": Payment.Method.WAVE, "amount": amount}],
    )


def _stock(store: Store, product: Product) -> Stock:
    return Stock.objects.get(store=store, product=product)


# --- Coût figé à la vente ----------------------------------------------------


def test_sale_freezes_the_store_average_cost(
    cash_session: CashSession, store: Store, product: Product, cashier
) -> None:
    sale = _sell(cash_session, product, 2)

    item = sale.items.get()
    assert item.unit_cost == Decimal("300.0000")
    movement = InventoryMovement.objects.get(movement_type=InventoryMovement.Type.SALE)
    assert movement.unit_cost == Decimal("300.0000")
    assert movement.created_by == cashier
    # Une vente ne change pas le coût moyen, seulement la quantité.
    stock = _stock(store, product)
    assert stock.quantity == Decimal("18.000")
    assert stock.average_unit_cost == Decimal("300.0000")


def test_past_sale_keeps_its_cost_when_the_cost_changes(
    cash_session: CashSession, store: Store
) -> None:
    rice = Product.objects.create(name="Riz 25kg", selling_price=Decimal("5000"))
    receive_stock(store=store, product=rice, quantity=10, unit_cost=Decimal("4000"))
    yesterday_sale = _sell(cash_session, rice, 1)

    Stock.objects.filter(store=store, product=rice).update(quantity=0)
    receive_stock(store=store, product=rice, quantity=10, unit_cost=Decimal("4500"))
    today_sale = _sell(cash_session, rice, 1)

    assert yesterday_sale.items.get().unit_cost == Decimal("4000.0000")
    assert today_sale.items.get().unit_cost == Decimal("4500.0000")


def test_sale_uses_the_price_actually_charged_next_to_the_cost(
    cash_session: CashSession, store: Store
) -> None:
    soda = Product.objects.create(name="Fanta", selling_price=Decimal("500"))
    Stock.objects.create(
        store=store, product=soda, quantity=5, average_unit_cost=Decimal("300")
    )

    item = _sell(cash_session, soda, 1, unit_price=Decimal("450")).items.get()

    assert item.catalog_unit_price == Decimal("500.00")
    assert item.line_total == Decimal("450.00")
    assert item.line_total - item.quantity * item.unit_cost == Decimal("150")


def test_sale_of_an_unknown_cost_product_keeps_the_cost_unknown(
    cash_session: CashSession, store: Store
) -> None:
    soap = Product.objects.create(name="Savon", selling_price=Decimal("250"))
    Stock.objects.create(store=store, product=soap, quantity=5)

    item = _sell(cash_session, soap, 1).items.get()

    assert item.unit_cost is None
    assert InventoryMovement.objects.get(movement_type=InventoryMovement.Type.SALE).unit_cost is None


def test_sale_takes_the_cost_of_its_own_store(cash_session: CashSession, product: Product) -> None:
    other_store = Store.objects.create(name="Boutique 2")
    Stock.objects.create(
        store=other_store, product=product, quantity=20, average_unit_cost=Decimal("420")
    )

    assert _sell(cash_session, product, 1).items.get().unit_cost == Decimal("300.0000")


def test_weighed_sale_freezes_the_cost_per_kilo(cash_session: CashSession, store: Store) -> None:
    banana = Product.objects.create(
        name="Banane", selling_price=Decimal("1200"), sale_unit=Product.SaleUnit.KG
    )
    Stock.objects.create(
        store=store, product=banana, quantity=Decimal("5.000"), average_unit_cost=Decimal("800")
    )

    item = _sell(cash_session, banana, "0.300").items.get()

    assert item.unit_cost == Decimal("800.0000")
    assert item.quantity * item.unit_cost == Decimal("240")


def _sell_offline(cash_session: CashSession, product: Product, quantity: str) -> Sale:
    amount = (product.selling_price * Decimal(quantity)).quantize(Decimal("0.01"))
    sale, _ = complete_offline_sale(
        sale_id=uuid4(),
        cash_session=cash_session,
        occurred_at=timezone.now(),
        payments=[{"method": Payment.Method.WAVE, "amount": amount}],
        items=[
            {
                "product_id": product.id,
                "product_name": product.name,
                "quantity": Decimal(quantity),
                "unit_price": product.selling_price,
            }
        ],
    )
    return sale


def test_offline_sale_freezes_the_server_cost_at_sync(
    cash_session: CashSession, product: Product
) -> None:
    assert _sell_offline(cash_session, product, "2").items.get().unit_cost == Decimal("300.0000")


def test_offline_sale_beyond_stock_still_freezes_the_cost(
    cash_session: CashSession, store: Store, product: Product
) -> None:
    sale = _sell_offline(cash_session, product, "25")

    assert sale.items.get().unit_cost == Decimal("300.0000")
    assert _stock(store, product).quantity == Decimal("-5.000")


def test_offline_sale_without_a_stock_row_has_an_unknown_cost(
    cash_session: CashSession, store: Store
) -> None:
    new_product = Product.objects.create(name="Biscuit", selling_price=Decimal("100"))

    sale = _sell_offline(cash_session, new_product, "1")

    assert sale.items.get().unit_cost is None
    assert _stock(store, new_product).average_unit_cost is None


# --- Annulation --------------------------------------------------------------


def test_cancellation_returns_units_at_their_frozen_cost(
    cash_session: CashSession, store: Store, product: Product, cashier
) -> None:
    sale = _sell(cash_session, product, 3)
    receive_stock(store=store, product=product, quantity=10, unit_cost=Decimal("400"))
    # (17 × 300 + 10 × 400) / 27 = 337,0370
    assert _stock(store, product).average_unit_cost == Decimal("337.0370")

    cancel_sale(sale_id=sale.id, cancelled_by=cashier, reason="Erreur de saisie")

    stock = _stock(store, product)
    assert stock.quantity == Decimal("30.000")
    # (27 × 337,0370 + 3 × 300) / 30 = 333,3333 — les 3 unités reviennent à 300.
    assert stock.average_unit_cost == Decimal("333.3333")
    movement = InventoryMovement.objects.get(movement_type=InventoryMovement.Type.CANCELLATION)
    assert movement.unit_cost == Decimal("300.0000")
    assert movement.created_by == cashier


def test_cancellation_right_after_the_sale_leaves_the_cost_unchanged(
    cash_session: CashSession, store: Store, product: Product, cashier
) -> None:
    sale = _sell(cash_session, product, 3)

    cancel_sale(sale_id=sale.id, cancelled_by=cashier, reason="Erreur de saisie")

    stock = _stock(store, product)
    assert stock.quantity == Decimal("20.000")
    assert stock.average_unit_cost == Decimal("300.0000")


def test_cancelling_an_unknown_cost_line_keeps_the_current_average(
    cash_session: CashSession, store: Store, product: Product, cashier
) -> None:
    Stock.objects.filter(store=store, product=product).update(average_unit_cost=None)
    sale = _sell(cash_session, product, 3)
    receive_stock(store=store, product=product, quantity=10, unit_cost=Decimal("400"))

    cancel_sale(sale_id=sale.id, cancelled_by=cashier, reason="Erreur de saisie")

    assert _stock(store, product).average_unit_cost == Decimal("400.0000")


def test_cancellation_into_a_negative_stock_takes_the_frozen_cost(
    cash_session: CashSession, store: Store, product: Product, cashier
) -> None:
    sale = _sell(cash_session, product, 3)
    Stock.objects.filter(store=store, product=product).update(
        quantity=Decimal("-5"), average_unit_cost=Decimal("380")
    )

    cancel_sale(sale_id=sale.id, cancelled_by=cashier, reason="Erreur de saisie")

    stock = _stock(store, product)
    assert stock.quantity == Decimal("-2.000")
    assert stock.average_unit_cost == Decimal("300.0000")


# --- Retours -----------------------------------------------------------------


def _return(sale: Sale, cash_session: CashSession, cashier, quantity, restock: bool, key=None):
    from apps.sales.services import create_sale_return

    item = sale.items.get()
    return create_sale_return(
        original_sale=sale,
        cash_session=cash_session,
        created_by=cashier,
        payment_method=Payment.Method.WAVE,
        idempotency_key=key or uuid4(),
        items=[{"sale_item_id": item.id, "quantity": Decimal(quantity), "restock": restock}],
    )


def test_restocked_return_brings_units_back_at_their_frozen_cost(
    cash_session: CashSession, store: Store, product: Product, cashier
) -> None:
    sale = _sell(cash_session, product, 3)
    receive_stock(store=store, product=product, quantity=10, unit_cost=Decimal("400"))

    _return(sale, cash_session, cashier, "3", restock=True)

    stock = _stock(store, product)
    assert stock.quantity == Decimal("30.000")
    # (27 × 337,0370 + 3 × 300) / 30 = 333,3333
    assert stock.average_unit_cost == Decimal("333.3333")
    movement = InventoryMovement.objects.get(movement_type=InventoryMovement.Type.RETURN_IN)
    assert movement.unit_cost == Decimal("300.0000")
    assert movement.created_by == cashier


def test_restocked_return_right_after_the_sale_is_neutral_on_cost(
    cash_session: CashSession, store: Store, product: Product, cashier
) -> None:
    sale = _sell(cash_session, product, 3)

    _return(sale, cash_session, cashier, "3", restock=True)

    stock = _stock(store, product)
    assert stock.quantity == Decimal("20.000")
    assert stock.average_unit_cost == Decimal("300.0000")


def test_return_without_restock_leaves_stock_and_cost_untouched(
    cash_session: CashSession, store: Store, product: Product, cashier
) -> None:
    sale = _sell(cash_session, product, 3)

    returned = _return(sale, cash_session, cashier, "3", restock=False)

    stock = _stock(store, product)
    assert stock.quantity == Decimal("17.000")
    assert stock.average_unit_cost == Decimal("300.0000")
    assert not InventoryMovement.objects.filter(
        movement_type=InventoryMovement.Type.RETURN_IN
    ).exists()
    # Le coût de l'article perdu reste lisible pour le rapport de rentabilité.
    return_item = returned.items.get()
    assert return_item.restock is False
    assert return_item.original_sale_item.unit_cost == Decimal("300.0000")


def test_partial_weighed_return_merges_at_the_frozen_cost_per_kilo(
    cash_session: CashSession, store: Store, cashier
) -> None:
    banana = Product.objects.create(
        name="Banane", selling_price=Decimal("1200"), sale_unit=Product.SaleUnit.KG
    )
    Stock.objects.create(
        store=store, product=banana, quantity=Decimal("1.000"), average_unit_cost=Decimal("800")
    )
    sale = _sell(cash_session, banana, "0.500")
    receive_stock(store=store, product=banana, quantity=Decimal("1.500"), unit_cost=Decimal("1000"))
    # (0,5 × 800 + 1,5 × 1000) / 2 = 950

    _return(sale, cash_session, cashier, "0.200", restock=True)

    stock = _stock(store, banana)
    assert stock.quantity == Decimal("2.200")
    # (2 × 950 + 0,2 × 800) / 2,2 = 936,3636
    assert stock.average_unit_cost == Decimal("936.3636")


def test_return_of_an_unknown_cost_line_keeps_the_current_average(
    cash_session: CashSession, store: Store, product: Product, cashier
) -> None:
    Stock.objects.filter(store=store, product=product).update(average_unit_cost=None)
    sale = _sell(cash_session, product, 3)
    receive_stock(store=store, product=product, quantity=10, unit_cost=Decimal("400"))

    _return(sale, cash_session, cashier, "3", restock=True)

    assert _stock(store, product).average_unit_cost == Decimal("400.0000")
    movement = InventoryMovement.objects.get(movement_type=InventoryMovement.Type.RETURN_IN)
    assert movement.unit_cost is None


def test_return_into_a_negative_stock_takes_the_frozen_cost(
    cash_session: CashSession, store: Store, product: Product, cashier
) -> None:
    sale = _sell(cash_session, product, 3)
    Stock.objects.filter(store=store, product=product).update(
        quantity=Decimal("-5"), average_unit_cost=Decimal("380")
    )

    _return(sale, cash_session, cashier, "3", restock=True)

    stock = _stock(store, product)
    assert stock.quantity == Decimal("-2.000")
    assert stock.average_unit_cost == Decimal("300.0000")


def test_replayed_return_does_not_merge_the_cost_twice(
    cash_session: CashSession, store: Store, product: Product, cashier
) -> None:
    sale = _sell(cash_session, product, 3)
    receive_stock(store=store, product=product, quantity=10, unit_cost=Decimal("400"))
    key = uuid4()

    _return(sale, cash_session, cashier, "3", restock=True, key=key)
    _return(sale, cash_session, cashier, "3", restock=True, key=key)

    stock = _stock(store, product)
    assert stock.quantity == Decimal("30.000")
    assert stock.average_unit_cost == Decimal("333.3333")
    assert InventoryMovement.objects.filter(
        movement_type=InventoryMovement.Type.RETURN_IN
    ).count() == 1
