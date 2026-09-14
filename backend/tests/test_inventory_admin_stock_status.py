from decimal import Decimal

import pytest
from django.contrib import admin

from apps.catalog.models import Product
from apps.inventory.admin import StockAdmin, StockStatusFilter
from apps.inventory.models import Stock
from apps.stores.models import Store


pytestmark = pytest.mark.django_db


@pytest.fixture
def store() -> Store:
    return Store.objects.create(name="Supérette Test")


@pytest.fixture
def product() -> Product:
    return Product.objects.create(name="Lait", selling_price=Decimal("600.00"))


@pytest.mark.parametrize(
    ("quantity", "expected_label"),
    [(0, "Rupture"), (2, "Faible"), (5, "Faible"), (10, "OK")],
)
def test_status_label(store: Store, product: Product, quantity, expected_label) -> None:
    stock = Stock.objects.create(store=store, product=product, quantity=quantity)
    model_admin = StockAdmin(Stock, admin.site)

    assert model_admin.status_label(stock) == expected_label


def test_stock_status_filter_low_excludes_out_of_stock(
    store: Store, product: Product
) -> None:
    out_of_stock = Stock.objects.create(store=store, product=product, quantity=0)
    low_stock_product = Product.objects.create(name="Pain", selling_price=Decimal("200"))
    low_stock = Stock.objects.create(store=store, product=low_stock_product, quantity=3)
    ok_product = Product.objects.create(name="Riz", selling_price=Decimal("1000"))
    Stock.objects.create(store=store, product=ok_product, quantity=50)

    model_admin = StockAdmin(Stock, admin.site)
    filter_instance = StockStatusFilter(
        request=None, params={"stock_status": ["low"]}, model=Stock, model_admin=model_admin
    )
    result = list(filter_instance.queryset(None, Stock.objects.all()))

    assert result == [low_stock]
    assert out_of_stock not in result


def test_stock_status_filter_out_returns_only_zero_or_negative(
    store: Store, product: Product
) -> None:
    out_of_stock = Stock.objects.create(store=store, product=product, quantity=0)
    other_product = Product.objects.create(name="Pain", selling_price=Decimal("200"))
    Stock.objects.create(store=store, product=other_product, quantity=3)

    model_admin = StockAdmin(Stock, admin.site)
    filter_instance = StockStatusFilter(
        request=None, params={"stock_status": ["out"]}, model=Stock, model_admin=model_admin
    )
    result = list(filter_instance.queryset(None, Stock.objects.all()))

    assert result == [out_of_stock]


def test_status_label_uses_the_product_own_threshold_when_set(store: Store) -> None:
    rice = Product.objects.create(
        name="Riz", selling_price=Decimal("15000.00"), low_stock_threshold=2
    )
    stock = Stock.objects.create(store=store, product=rice, quantity=8)
    model_admin = StockAdmin(Stock, admin.site)

    assert model_admin.status_label(stock) == "OK"


def test_stock_status_filter_low_uses_the_product_own_threshold(store: Store) -> None:
    # Seuil global (5) ne s'appliquerait pas ici : sans son propre seuil, ce
    # produit n'apparaîtrait pas en "stock faible" à 8 unités.
    rice = Product.objects.create(
        name="Riz", selling_price=Decimal("15000.00"), low_stock_threshold=2
    )
    low_rice_stock = Stock.objects.create(store=store, product=rice, quantity=2)
    ok_rice_stock = Stock.objects.create(
        store=store,
        product=Product.objects.create(
            name="Riz jasmin", selling_price=Decimal("16000.00"), low_stock_threshold=2
        ),
        quantity=8,
    )

    model_admin = StockAdmin(Stock, admin.site)
    filter_instance = StockStatusFilter(
        request=None, params={"stock_status": ["low"]}, model=Stock, model_admin=model_admin
    )
    result = list(filter_instance.queryset(None, Stock.objects.all()))

    assert result == [low_rice_stock]
    assert ok_rice_stock not in result
