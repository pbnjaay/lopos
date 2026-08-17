from decimal import Decimal

import pytest
from django.contrib import admin
from django.db import IntegrityError, transaction
from django.test import RequestFactory

from apps.catalog.models import Product
from apps.inventory.admin import InventoryMovementAdmin
from apps.inventory.models import InventoryMovement, Stock
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


def test_stock_is_unique_per_store_and_product(store: Store, product: Product) -> None:
    Stock.objects.create(store=store, product=product, quantity=10)

    with pytest.raises(IntegrityError), transaction.atomic():
        Stock.objects.create(store=store, product=product, quantity=20)


def test_stock_cannot_be_negative(store: Store, product: Product) -> None:
    with pytest.raises(IntegrityError), transaction.atomic():
        Stock.objects.create(store=store, product=product, quantity=-1)


def test_zero_quantity_movement_is_rejected(store: Store, product: Product) -> None:
    with pytest.raises(IntegrityError), transaction.atomic():
        InventoryMovement.objects.create(
            store=store,
            product=product,
            movement_type=InventoryMovement.Type.ADJUSTMENT,
            quantity=0,
        )


def test_inventory_models_are_registered_in_admin() -> None:
    assert Stock in admin.site._registry
    assert InventoryMovement in admin.site._registry


def test_inventory_movement_admin_is_read_only() -> None:
    model_admin = InventoryMovementAdmin(InventoryMovement, admin.site)
    request = RequestFactory().get("/admin/")

    assert model_admin.has_add_permission(request) is False
    assert model_admin.has_change_permission(request) is False
    assert model_admin.has_delete_permission(request) is False
