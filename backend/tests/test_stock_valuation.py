from decimal import Decimal

import pytest

from apps.catalog.models import Product
from apps.inventory.models import Stock
from apps.inventory.valuation import (
    annotate_stock_values,
    get_stock_valuation,
    summarize_stock_valuation,
)
from apps.stores.models import Store


pytestmark = pytest.mark.django_db


@pytest.fixture
def store() -> Store:
    return Store.objects.create(name="Supérette Test")


def _stock(store: Store, name: str, quantity, selling_price, cost) -> Stock:
    product = Product.objects.create(name=name, selling_price=Decimal(selling_price))
    return Stock.objects.create(
        store=store,
        product=product,
        quantity=Decimal(quantity),
        average_unit_cost=None if cost is None else Decimal(cost),
    )


def test_simple_stock_is_valued_at_cost_and_at_selling_price(store: Store) -> None:
    _stock(store, "Coca 50cl", "10", "500", "300")

    summary = get_stock_valuation(store_id=store.id)

    assert summary.cost_value == Decimal("3000.00")
    assert summary.sale_value == Decimal("5000.00")
    assert summary.potential_margin == Decimal("2000.00")
    assert summary.coverage_percent == 100
    assert summary.is_complete


def test_each_stock_line_carries_its_values(store: Store) -> None:
    _stock(store, "Coca 50cl", "24", "500", "350")

    row = annotate_stock_values(Stock.objects.all()).get()

    assert row.valued_quantity == Decimal("24")
    assert row.cost_value == Decimal("8400")
    assert row.sale_value == Decimal("12000")
    assert row.potential_margin == Decimal("3600")


def test_weighted_average_cost_is_rounded_only_on_the_total(store: Store) -> None:
    _stock(store, "Coca 50cl", "30", "500", "333.3333")

    summary = get_stock_valuation(store_id=store.id)

    # 30 × 333,3333 = 9 999,999 → 10 000,00
    assert summary.cost_value == Decimal("10000.00")
    assert summary.sale_value == Decimal("15000.00")
    assert summary.potential_margin == Decimal("5000.00")


def test_weighed_products_are_valued_per_kilo(store: Store) -> None:
    _stock(store, "Riz au kilo", "2.500", "600", "460")

    summary = get_stock_valuation(store_id=store.id)

    assert summary.cost_value == Decimal("1150.00")
    assert summary.sale_value == Decimal("1500.00")


def test_negative_stock_is_not_valued_but_reported(store: Store) -> None:
    _stock(store, "Coca 50cl", "10", "500", "300")
    negative = _stock(store, "Fanta", "-2", "500", "300")

    summary = get_stock_valuation(store_id=store.id)
    row = annotate_stock_values(Stock.objects.filter(pk=negative.pk)).get()

    assert summary.cost_value == Decimal("3000.00")
    assert summary.sale_value == Decimal("5000.00")
    assert summary.negative_count == 1
    assert row.valued_quantity == Decimal("0")
    assert row.cost_value == Decimal("0")


def test_unknown_cost_is_never_valued_at_zero(store: Store) -> None:
    _stock(store, "Coca 50cl", "10", "500", "300")
    unknown = _stock(store, "Savon", "20", "250", None)

    summary = get_stock_valuation(store_id=store.id)
    row = annotate_stock_values(Stock.objects.filter(pk=unknown.pk)).get()

    # Le savon ne gonfle ni la valeur de vente ni la marge potentielle…
    assert summary.cost_value == Decimal("3000.00")
    assert summary.sale_value == Decimal("5000.00")
    assert summary.potential_margin == Decimal("2000.00")
    # …il est signalé à part.
    assert summary.uncosted_count == 1
    assert summary.uncosted_sale_value == Decimal("5000.00")
    assert summary.coverage_percent == 50
    assert not summary.is_complete
    assert row.cost_value is None
    assert row.potential_margin is None
    assert row.sale_value == Decimal("5000")


def test_empty_stocks_count_nowhere(store: Store) -> None:
    _stock(store, "Coca 50cl", "0", "500", "300")
    _stock(store, "Savon", "0", "250", None)

    summary = get_stock_valuation(store_id=store.id)

    assert summary.cost_value == Decimal("0.00")
    assert summary.uncosted_count == 0
    assert summary.negative_count == 0
    assert summary.coverage_percent is None


def test_valuation_is_scoped_to_its_store(store: Store) -> None:
    other_store = Store.objects.create(name="Boutique 2")
    _stock(store, "Coca 50cl", "10", "500", "300")
    _stock(other_store, "Fanta", "4", "500", "350")
    _stock(other_store, "Savon", "-1", "250", None)

    here = get_stock_valuation(store_id=store.id)
    there = get_stock_valuation(store_id=other_store.id)
    everywhere = get_stock_valuation()

    assert here.cost_value == Decimal("3000.00")
    assert here.negative_count == 0
    assert there.cost_value == Decimal("1400.00")
    assert there.negative_count == 1
    assert everywhere.cost_value == Decimal("4400.00")
    assert everywhere.sale_value == Decimal("7000.00")


def test_summary_follows_any_filtered_list(store: Store) -> None:
    _stock(store, "Coca 50cl", "10", "500", "300")
    _stock(store, "Fanta", "4", "500", "350")

    summary = summarize_stock_valuation(Stock.objects.filter(product__name__icontains="coca"))

    assert summary.cost_value == Decimal("3000.00")


def test_summary_is_a_single_query(store: Store, django_assert_num_queries) -> None:
    for index in range(5):
        _stock(store, f"Produit {index}", "10", "500", "300")
    _stock(store, "Savon", "20", "250", None)

    with django_assert_num_queries(1):
        get_stock_valuation(store_id=store.id)
