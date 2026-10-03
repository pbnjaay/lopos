from decimal import Decimal

import pytest
from django.contrib import admin

from apps.catalog.models import Product
from apps.inventory.models import Stock
from apps.stores.admin import StoreAdmin
from apps.stores.models import CashRegister, Store


pytestmark = pytest.mark.django_db


def test_store_overview_counts_registers_and_stocked_products() -> None:
    store = Store.objects.create(name="Supérette Test")
    CashRegister.objects.create(store=store, name="Caisse 01")
    CashRegister.objects.create(store=store, name="Caisse 02")

    coca = Product.objects.create(name="Coca", selling_price=Decimal("500"))
    pain = Product.objects.create(name="Pain", selling_price=Decimal("200"))
    out_of_stock = Product.objects.create(name="Lait", selling_price=Decimal("600"))
    Stock.objects.create(store=store, product=coca, quantity=10)
    Stock.objects.create(store=store, product=pain, quantity=5)
    Stock.objects.create(store=store, product=out_of_stock, quantity=0)

    model_admin = StoreAdmin(Store, admin.site)
    obj = model_admin.get_queryset(request=None).get(pk=store.pk)

    assert model_admin.cash_register_count(obj) == 2
    assert model_admin.stocked_product_count(obj) == 2
