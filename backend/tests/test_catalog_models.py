from decimal import Decimal

import pytest
from django.contrib import admin
from django.db import IntegrityError, transaction

from apps.catalog.models import Product, format_product_name


pytestmark = pytest.mark.django_db


@pytest.mark.parametrize(
    ("raw_name", "expected"),
    [
        ("COCA COLA 50CL", "Coca Cola 50cl"),
        ("coca cola 50cl", "Coca Cola 50cl"),
        ("  Coca   Cola   50cl  ", "Coca Cola 50cl"),
        ("iPhone 15", "iPhone 15"),
        ("Riz parfumé 5kg", "Riz Parfumé 5kg"),
    ],
)
def test_format_product_name(raw_name: str, expected: str) -> None:
    assert format_product_name(raw_name) == expected


def test_product_name_is_formatted_on_save() -> None:
    product = Product.objects.create(name="  coca COLA 50cl  ", selling_price=Decimal("500"))

    assert product.name == "Coca Cola 50cl"


def test_product_accepts_nonnegative_prices_and_null_barcode() -> None:
    first = Product.objects.create(
        name="Coca 50cl",
        selling_price=Decimal("500.00"),
        purchase_price=Decimal("400.00"),
    )
    Product.objects.create(name="Pain", selling_price=Decimal("0.00"))

    assert first.selling_price == Decimal("500.00")
    assert first.is_active is True
    assert Product.objects.filter(barcode__isnull=True).count() == 2


@pytest.mark.parametrize("price_field", ["selling_price", "purchase_price"])
def test_product_rejects_negative_prices(price_field: str) -> None:
    values = {
        "name": "Prix invalide",
        "selling_price": Decimal("100.00"),
        "purchase_price": Decimal("50.00"),
    }
    values[price_field] = Decimal("-0.01")

    with pytest.raises(IntegrityError), transaction.atomic():
        Product.objects.create(**values)


def test_product_barcode_is_unique_when_set() -> None:
    Product.objects.create(
        name="Premier produit",
        barcode="123456789",
        selling_price=Decimal("500.00"),
    )

    with pytest.raises(IntegrityError), transaction.atomic():
        Product.objects.create(
            name="Second produit",
            barcode="123456789",
            selling_price=Decimal("600.00"),
        )


def test_product_is_registered_in_admin() -> None:
    assert Product in admin.site._registry
