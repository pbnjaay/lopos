from decimal import Decimal
from unittest.mock import patch

import pytest

from apps.catalog.models import Product
from apps.inventory.exceptions import InvalidStockQuantity
from apps.inventory.models import InventoryMovement, Stock
from apps.inventory.services import adjust_stock, receive_stock
from apps.stores.models import Store


pytestmark = pytest.mark.django_db


@pytest.fixture
def store() -> Store:
    return Store.objects.create(name="Supérette Test")


@pytest.fixture
def product() -> Product:
    return Product.objects.create(
        name="Coca 50cl",
        selling_price=Decimal("500.00"),
    )


def test_receive_stock_creates_stock_and_movement(
    store: Store,
    product: Product,
) -> None:
    result = receive_stock(store=store, product=product, quantity=20)

    assert result.stock.quantity == 20
    assert result.quantity_added == 20
    assert result.movement.movement_type == InventoryMovement.Type.STOCK_IN
    assert result.movement.quantity == 20
    assert result.movement.store == store
    assert result.movement.product == product


def test_receive_stock_increments_existing_stock(
    store: Store,
    product: Product,
) -> None:
    Stock.objects.create(store=store, product=product, quantity=10)

    result = receive_stock(store=store, product=product, quantity=20)

    assert result.stock.quantity == 30
    assert Stock.objects.get(store=store, product=product).quantity == 30
    assert InventoryMovement.objects.get().quantity == 20


@pytest.mark.parametrize("quantity", [0, -1, True])
def test_receive_stock_rejects_invalid_quantity(
    store: Store,
    product: Product,
    quantity: int,
) -> None:
    with pytest.raises(InvalidStockQuantity):
        receive_stock(store=store, product=product, quantity=quantity)

    assert Stock.objects.count() == 0
    assert InventoryMovement.objects.count() == 0


def test_receive_stock_rolls_back_when_movement_creation_fails(
    store: Store,
    product: Product,
) -> None:
    stock = Stock.objects.create(store=store, product=product, quantity=10)

    with (
        patch.object(
            InventoryMovement.objects,
            "create",
            side_effect=RuntimeError("forced movement failure"),
        ),
        pytest.raises(RuntimeError, match="forced movement failure"),
    ):
        receive_stock(store=store, product=product, quantity=20)

    stock.refresh_from_db()
    assert stock.quantity == 10
    assert InventoryMovement.objects.count() == 0


def test_adjust_stock_decreases_quantity_and_records_negative_delta(
    store: Store,
    product: Product,
) -> None:
    Stock.objects.create(store=store, product=product, quantity=24)

    result = adjust_stock(store=store, product=product, counted_quantity=22)

    assert result.previous_quantity == 24
    assert result.delta == -2
    assert result.stock.quantity == 22
    assert Stock.objects.get(store=store, product=product).quantity == 22
    assert result.movement.movement_type == InventoryMovement.Type.ADJUSTMENT
    assert result.movement.quantity == -2


def test_adjust_stock_increases_quantity_and_records_positive_delta(
    store: Store,
    product: Product,
) -> None:
    Stock.objects.create(store=store, product=product, quantity=10)

    result = adjust_stock(store=store, product=product, counted_quantity=15)

    assert result.delta == 5
    assert result.movement.quantity == 5
    assert result.stock.quantity == 15


def test_adjust_stock_creates_stock_when_missing(store: Store, product: Product) -> None:
    result = adjust_stock(store=store, product=product, counted_quantity=8)

    assert result.previous_quantity == 0
    assert result.delta == 8
    assert result.stock.quantity == 8
    assert Stock.objects.get(store=store, product=product).quantity == 8


def test_adjust_stock_with_unchanged_quantity_creates_no_movement(
    store: Store,
    product: Product,
) -> None:
    Stock.objects.create(store=store, product=product, quantity=24)

    result = adjust_stock(store=store, product=product, counted_quantity=24)

    assert result.delta == 0
    assert result.movement is None
    assert InventoryMovement.objects.count() == 0
    assert Stock.objects.get(store=store, product=product).quantity == 24


@pytest.mark.parametrize("counted_quantity", [-1, True])
def test_adjust_stock_rejects_invalid_counted_quantity(
    store: Store,
    product: Product,
    counted_quantity: int,
) -> None:
    Stock.objects.create(store=store, product=product, quantity=24)

    with pytest.raises(InvalidStockQuantity):
        adjust_stock(store=store, product=product, counted_quantity=counted_quantity)

    assert Stock.objects.get(store=store, product=product).quantity == 24
    assert InventoryMovement.objects.count() == 0
