import io
from decimal import Decimal

import pytest

from apps.catalog.models import Product
from apps.catalog.services import import_products_from_csv
from apps.inventory.models import InventoryMovement, Stock
from apps.stores.models import Store


pytestmark = pytest.mark.django_db


@pytest.fixture
def store() -> Store:
    return Store.objects.create(name="Supérette Louga")


def _csv_file(content: str) -> io.BytesIO:
    return io.BytesIO(content.encode("utf-8"))


def test_import_creates_products_without_stock() -> None:
    content = (
        "barcode,name,purchase_price,selling_price,store,initial_stock\n"
        "5449000000996,Coca 50cl,350,500,,0\n"
        "1234567890123,Pain,100,150,,\n"
    )

    result = import_products_from_csv(_csv_file(content))

    assert result.errors == []
    assert result.created_count == 2
    assert Product.objects.count() == 2
    assert not Stock.objects.exists()
    assert not InventoryMovement.objects.exists()


def test_import_creates_products_with_initial_stock(store: Store) -> None:
    content = (
        "barcode,name,purchase_price,selling_price,store,initial_stock\n"
        f"5449000000996,Coca 50cl,350,500,{store.name},24\n"
    )

    result = import_products_from_csv(_csv_file(content))

    assert result.errors == []
    assert result.created_count == 1

    product = Product.objects.get(barcode="5449000000996")
    stock = Stock.objects.get(product=product, store=store)
    assert stock.quantity == 24

    movement = InventoryMovement.objects.get(product=product, store=store)
    assert movement.movement_type == InventoryMovement.Type.STOCK_IN
    assert movement.quantity == 24


def test_import_rejects_duplicate_barcode_already_in_db(store: Store) -> None:
    Product.objects.create(
        name="Coca existant", barcode="5449000000996", selling_price=Decimal("500")
    )
    content = (
        "barcode,name,purchase_price,selling_price,store,initial_stock\n"
        "5449000000996,Coca 50cl,350,500,,0\n"
    )

    result = import_products_from_csv(_csv_file(content))

    assert result.created_count == 0
    assert len(result.errors) == 1
    assert "existe déjà" in result.errors[0].message
    assert Product.objects.count() == 1


def test_import_rejects_duplicate_barcode_within_file() -> None:
    content = (
        "barcode,name,purchase_price,selling_price,store,initial_stock\n"
        "5449000000996,Coca 50cl,350,500,,0\n"
        "5449000000996,Coca 50cl bis,350,500,,0\n"
    )

    result = import_products_from_csv(_csv_file(content))

    assert result.created_count == 0
    assert any("en double" in error.message for error in result.errors)
    assert Product.objects.count() == 0


def test_import_rejects_stock_without_store() -> None:
    content = (
        "barcode,name,purchase_price,selling_price,store,initial_stock\n"
        "5449000000996,Coca 50cl,350,500,,24\n"
    )

    result = import_products_from_csv(_csv_file(content))

    assert result.created_count == 0
    assert any("magasin est requis" in error.message.lower() for error in result.errors)
    assert Product.objects.count() == 0


def test_import_rejects_unknown_store() -> None:
    content = (
        "barcode,name,purchase_price,selling_price,store,initial_stock\n"
        "5449000000996,Coca 50cl,350,500,Inconnu,24\n"
    )

    result = import_products_from_csv(_csv_file(content))

    assert result.created_count == 0
    assert any("introuvable" in error.message for error in result.errors)


def test_import_is_all_or_nothing_when_one_row_is_invalid(store: Store) -> None:
    content = (
        "barcode,name,purchase_price,selling_price,store,initial_stock\n"
        f"5449000000996,Coca 50cl,350,500,{store.name},24\n"
        ",Produit sans prix,,,,\n"
    )

    result = import_products_from_csv(_csv_file(content))

    assert result.created_count == 0
    assert len(result.errors) == 1
    assert result.errors[0].line == 3
    assert Product.objects.count() == 0
    assert not Stock.objects.exists()


def test_import_rejects_missing_required_columns() -> None:
    content = "name,price\nCoca,500\n"

    result = import_products_from_csv(_csv_file(content))

    assert result.created_count == 0
    assert "Colonnes manquantes" in result.errors[0].message


def test_import_rejects_empty_file() -> None:
    content = "barcode,name,purchase_price,selling_price,store,initial_stock\n"

    result = import_products_from_csv(_csv_file(content))

    assert result.created_count == 0
    assert "vide" in result.errors[0].message
