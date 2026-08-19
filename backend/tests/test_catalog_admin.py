from decimal import Decimal
from unittest.mock import patch

import pytest
from django.contrib.auth.models import User
from django.core.files.uploadedfile import SimpleUploadedFile
from django.urls import reverse

from apps.catalog.models import Product
from apps.inventory.models import InventoryMovement, Stock
from apps.stores.models import Store


pytestmark = pytest.mark.django_db


@pytest.fixture
def store() -> Store:
    return Store.objects.create(name="Supérette Louga")


@pytest.fixture
def product(store: Store) -> Product:
    product = Product.objects.create(
        name="Coca 50cl",
        barcode="5449000000996",
        selling_price=Decimal("500.00"),
        purchase_price=Decimal("350.00"),
    )
    Stock.objects.create(store=store, product=product, quantity=24)
    return product


@pytest.fixture
def admin_client(client) -> "django.test.Client":  # noqa: F821
    User.objects.create_superuser(username="manager", password="pass1234", email="m@example.com")
    client.login(username="manager", password="pass1234")
    return client


def _product_post_data(**overrides) -> dict:
    data = {
        "name": "Coca 50cl",
        "barcode": "5449000000996",
        "selling_price": "500.00",
        "purchase_price": "350.00",
        "is_active": "on",
        "initial_store": "",
        "initial_quantity": "0",
    }
    data.update(overrides)
    return data


def test_create_product_without_initial_stock_creates_no_movement(admin_client) -> None:
    response = admin_client.post(
        reverse("admin:catalog_product_add"),
        _product_post_data(),
        follow=True,
    )

    assert response.status_code == 200
    product = Product.objects.get(barcode="5449000000996")
    assert not Stock.objects.filter(product=product).exists()
    assert not InventoryMovement.objects.filter(product=product).exists()


def test_create_product_with_initial_stock(admin_client, store: Store) -> None:
    response = admin_client.post(
        reverse("admin:catalog_product_add"),
        _product_post_data(initial_store=str(store.pk), initial_quantity="24"),
        follow=True,
    )

    assert response.status_code == 200
    product = Product.objects.get(barcode="5449000000996")

    stock = Stock.objects.get(product=product, store=store)
    assert stock.quantity == 24

    movement = InventoryMovement.objects.get(product=product, store=store)
    assert movement.movement_type == InventoryMovement.Type.STOCK_IN
    assert movement.quantity == 24


def test_create_product_with_quantity_but_no_store_is_rejected(admin_client) -> None:
    response = admin_client.post(
        reverse("admin:catalog_product_add"),
        _product_post_data(initial_quantity="24"),
    )

    assert response.status_code == 200
    assert "Sélectionnez un magasin" in response.content.decode()
    assert not Product.objects.filter(barcode="5449000000996").exists()


def test_create_product_rolls_back_when_receive_stock_fails(admin_client, store: Store) -> None:
    with patch("apps.catalog.admin.receive_stock", side_effect=RuntimeError("boom")):
        with pytest.raises(RuntimeError):
            admin_client.post(
                reverse("admin:catalog_product_add"),
                _product_post_data(initial_store=str(store.pk), initial_quantity="24"),
            )

    assert not Product.objects.filter(barcode="5449000000996").exists()
    assert not Stock.objects.exists()
    assert not InventoryMovement.objects.exists()


def test_editing_product_does_not_replay_initial_stock(admin_client, store: Store) -> None:
    admin_client.post(
        reverse("admin:catalog_product_add"),
        _product_post_data(initial_store=str(store.pk), initial_quantity="24"),
    )
    product = Product.objects.get(barcode="5449000000996")
    assert Stock.objects.get(product=product, store=store).quantity == 24

    response = admin_client.post(
        reverse("admin:catalog_product_change", args=[product.pk]),
        _product_post_data(selling_price="550.00"),
        follow=True,
    )

    assert response.status_code == 200
    product.refresh_from_db()
    assert product.selling_price == Decimal("550.00")

    stock = Stock.objects.get(product=product, store=store)
    assert stock.quantity == 24
    assert InventoryMovement.objects.filter(product=product).count() == 1


def test_product_change_page_shows_stocks_overview(admin_client, product: Product) -> None:
    response = admin_client.get(reverse("admin:catalog_product_change", args=[product.pk]))

    assert response.status_code == 200
    content = response.content.decode()
    assert "Supérette Louga" in content
    assert "Ajouter du stock" in content
    assert "Ajuster le stock" in content


def test_receive_stock_view_adds_stock(admin_client, product: Product, store: Store) -> None:
    response = admin_client.post(
        reverse("admin:catalog_product_receive_stock", args=[product.pk]),
        {"store": str(store.pk), "quantity": "12"},
        follow=True,
    )

    assert response.status_code == 200

    stock = Stock.objects.get(product=product, store=store)
    assert stock.quantity == 36

    movement = InventoryMovement.objects.get(
        product=product, store=store, movement_type=InventoryMovement.Type.STOCK_IN
    )
    assert movement.quantity == 12


def test_receive_stock_view_rejects_non_positive_quantity(
    admin_client, product: Product, store: Store
) -> None:
    response = admin_client.post(
        reverse("admin:catalog_product_receive_stock", args=[product.pk]),
        {"store": str(store.pk), "quantity": "0"},
    )

    assert response.status_code == 200
    stock = Stock.objects.get(product=product, store=store)
    assert stock.quantity == 24
    assert not InventoryMovement.objects.filter(product=product).exists()


def test_receive_stock_view_requires_change_permission(client, product: Product, store: Store) -> None:
    User.objects.create_user(
        username="cashier", password="pass1234", is_staff=True
    )
    client.login(username="cashier", password="pass1234")

    response = client.post(
        reverse("admin:catalog_product_receive_stock", args=[product.pk]),
        {"store": str(store.pk), "quantity": "12"},
    )

    assert response.status_code == 403
    stock = Stock.objects.get(product=product, store=store)
    assert stock.quantity == 24


def test_adjust_stock_view_decreases_quantity(admin_client, product: Product, store: Store) -> None:
    response = admin_client.post(
        reverse("admin:catalog_product_adjust_stock", args=[product.pk]),
        {"store": str(store.pk), "counted_quantity": "22"},
        follow=True,
    )

    assert response.status_code == 200

    stock = Stock.objects.get(product=product, store=store)
    assert stock.quantity == 22

    movement = InventoryMovement.objects.get(
        product=product, store=store, movement_type=InventoryMovement.Type.ADJUSTMENT
    )
    assert movement.quantity == -2


def test_adjust_stock_view_with_same_quantity_creates_no_movement(
    admin_client, product: Product, store: Store
) -> None:
    response = admin_client.post(
        reverse("admin:catalog_product_adjust_stock", args=[product.pk]),
        {"store": str(store.pk), "counted_quantity": "24"},
        follow=True,
    )

    assert response.status_code == 200
    stock = Stock.objects.get(product=product, store=store)
    assert stock.quantity == 24
    assert not InventoryMovement.objects.filter(
        product=product, movement_type=InventoryMovement.Type.ADJUSTMENT
    ).exists()


def test_adjust_stock_view_rejects_negative_quantity(
    admin_client, product: Product, store: Store
) -> None:
    response = admin_client.post(
        reverse("admin:catalog_product_adjust_stock", args=[product.pk]),
        {"store": str(store.pk), "counted_quantity": "-1"},
    )

    assert response.status_code == 200
    stock = Stock.objects.get(product=product, store=store)
    assert stock.quantity == 24
    assert not InventoryMovement.objects.filter(
        product=product, movement_type=InventoryMovement.Type.ADJUSTMENT
    ).exists()


def test_adjust_stock_view_requires_change_permission(client, product: Product, store: Store) -> None:
    User.objects.create_user(username="cashier", password="pass1234", is_staff=True)
    client.login(username="cashier", password="pass1234")

    response = client.post(
        reverse("admin:catalog_product_adjust_stock", args=[product.pk]),
        {"store": str(store.pk), "counted_quantity": "22"},
    )

    assert response.status_code == 403
    stock = Stock.objects.get(product=product, store=store)
    assert stock.quantity == 24


def _csv_upload(content: str) -> SimpleUploadedFile:
    return SimpleUploadedFile(
        "products.csv", content.encode("utf-8"), content_type="text/csv"
    )


def test_import_products_view_creates_products(admin_client, store: Store) -> None:
    content = (
        "barcode,name,purchase_price,selling_price,store,initial_stock\n"
        f"1234567890123,Pain,100,150,{store.name},40\n"
    )

    response = admin_client.post(
        reverse("admin:catalog_product_import_products_view"),
        {"csv_file": _csv_upload(content)},
        follow=True,
    )

    assert response.status_code == 200
    product = Product.objects.get(barcode="1234567890123")
    stock = Stock.objects.get(product=product, store=store)
    assert stock.quantity == 40
    assert InventoryMovement.objects.get(product=product).movement_type == (
        InventoryMovement.Type.STOCK_IN
    )


def test_import_products_view_reports_errors_and_imports_nothing(admin_client) -> None:
    content = "barcode,name,purchase_price,selling_price,store,initial_stock\n,,,,,\n"

    response = admin_client.post(
        reverse("admin:catalog_product_import_products_view"),
        {"csv_file": _csv_upload(content)},
    )

    assert response.status_code == 200
    assert "Ligne 2" in response.content.decode()
    assert not Product.objects.exists()


def test_import_products_button_visible_on_changelist(admin_client) -> None:
    response = admin_client.get(reverse("admin:catalog_product_changelist"))

    assert response.status_code == 200
    assert "Importer des produits" in response.content.decode()


def test_import_products_view_requires_add_permission(client, store: Store) -> None:
    User.objects.create_user(username="cashier", password="pass1234", is_staff=True)
    client.login(username="cashier", password="pass1234")

    content = (
        "barcode,name,purchase_price,selling_price,store,initial_stock\n"
        f"1234567890123,Pain,100,150,{store.name},40\n"
    )

    response = client.post(
        reverse("admin:catalog_product_import_products_view"),
        {"csv_file": _csv_upload(content)},
    )

    assert response.status_code == 403
    assert not Product.objects.exists()
