from decimal import Decimal
from unittest.mock import patch

import pytest

from apps.catalog.models import Product
from apps.inventory.exceptions import InvalidStockQuantity
from apps.inventory.models import InventoryMovement, Stock
from apps.inventory.services import receive_stock
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
