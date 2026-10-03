from decimal import Decimal
from importlib import import_module

import pytest
from django.apps import apps as django_apps
from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction

from apps.catalog.models import Product
from apps.inventory.models import InventoryMovement, Stock, StockCostChange
from apps.stores.models import Store


pytestmark = pytest.mark.django_db
User = get_user_model()

initial_cost_migration = import_module(
    "apps.inventory.migrations.0007_initialize_average_cost_from_purchase_price"
)


def run_initialization() -> None:
    initial_cost_migration.initialize_average_cost(django_apps, None)


@pytest.fixture
def store() -> Store:
    return Store.objects.create(name="Supérette Test")


@pytest.fixture
def product() -> Product:
    return Product.objects.create(
        name="Coca 50cl",
        selling_price=Decimal("500.00"),
        purchase_price=Decimal("350.00"),
    )


# --- Modèle ---------------------------------------------------------------


def test_stock_cost_is_unknown_by_default(store: Store, product: Product) -> None:
    stock = Stock.objects.create(store=store, product=product, quantity=10)

    assert stock.average_unit_cost is None


def test_stock_keeps_a_four_decimal_average_cost(store: Store, product: Product) -> None:
    stock = Stock.objects.create(
        store=store, product=product, quantity=30, average_unit_cost=Decimal("333.3333")
    )
    stock.refresh_from_db()

    assert stock.average_unit_cost == Decimal("333.3333")


def test_stock_rejects_a_negative_average_cost(store: Store, product: Product) -> None:
    with pytest.raises(IntegrityError), transaction.atomic():
        Stock.objects.create(
            store=store, product=product, quantity=1, average_unit_cost=Decimal("-1")
        )


def test_movement_rejects_a_negative_unit_cost(store: Store, product: Product) -> None:
    with pytest.raises(IntegrityError), transaction.atomic():
        InventoryMovement.objects.create(
            store=store,
            product=product,
            movement_type=InventoryMovement.Type.STOCK_IN,
            quantity=1,
            unit_cost=Decimal("-0.0001"),
        )


def test_movement_records_its_cost_and_author(store: Store, product: Product) -> None:
    manager = User.objects.create_user(username="gerant")
    movement = InventoryMovement.objects.create(
        store=store,
        product=product,
        movement_type=InventoryMovement.Type.STOCK_IN,
        quantity=20,
        unit_cost=Decimal("350"),
        created_by=manager,
    )
    movement.refresh_from_db()

    assert movement.unit_cost == Decimal("350.0000")
    assert movement.created_by == manager


def test_initialization_must_start_from_an_unknown_cost(store: Store, product: Product) -> None:
    with pytest.raises(IntegrityError), transaction.atomic():
        StockCostChange.objects.create(
            store=store,
            product=product,
            source=StockCostChange.Source.INITIAL,
            previous_cost=Decimal("300"),
            new_cost=Decimal("350"),
            quantity_at_change=10,
        )


def test_correction_requires_a_reason(store: Store, product: Product) -> None:
    with pytest.raises(IntegrityError), transaction.atomic():
        StockCostChange.objects.create(
            store=store,
            product=product,
            source=StockCostChange.Source.CORRECTION,
            previous_cost=Decimal("300"),
            new_cost=Decimal("350"),
            quantity_at_change=10,
            reason="",
        )


def test_cost_change_rejects_a_negative_cost(store: Store, product: Product) -> None:
    with pytest.raises(IntegrityError), transaction.atomic():
        StockCostChange.objects.create(
            store=store,
            product=product,
            source=StockCostChange.Source.INITIAL,
            new_cost=Decimal("-1"),
            quantity_at_change=10,
        )


# --- Initialisation unique depuis le prix d'achat catalogue -----------------


def test_initializes_unknown_cost_from_purchase_price_with_an_audit_row(
    store: Store, product: Product
) -> None:
    stock = Stock.objects.create(store=store, product=product, quantity=24)

    run_initialization()

    stock.refresh_from_db()
    assert stock.average_unit_cost == Decimal("350.0000")
    change = StockCostChange.objects.get()
    assert change.store == store
    assert change.product == product
    assert change.source == StockCostChange.Source.INITIAL
    assert change.previous_cost is None
    assert change.new_cost == Decimal("350.0000")
    assert change.quantity_at_change == Decimal("24.000")
    assert change.created_by is None
    assert change.reason == initial_cost_migration.INITIAL_REASON


@pytest.mark.parametrize("purchase_price", [None, Decimal("0.00")])
def test_leaves_cost_unknown_without_a_real_purchase_price(
    store: Store, product: Product, purchase_price: Decimal | None
) -> None:
    Product.objects.filter(pk=product.pk).update(purchase_price=purchase_price)
    stock = Stock.objects.create(store=store, product=product, quantity=10)

    run_initialization()

    stock.refresh_from_db()
    assert stock.average_unit_cost is None
    assert not StockCostChange.objects.exists()


def test_never_overwrites_a_known_cost(store: Store, product: Product) -> None:
    stock = Stock.objects.create(
        store=store, product=product, quantity=10, average_unit_cost=Decimal("300")
    )

    run_initialization()

    stock.refresh_from_db()
    assert stock.average_unit_cost == Decimal("300.0000")
    assert not StockCostChange.objects.exists()


def test_initializes_empty_and_negative_stocks_too(store: Store, product: Product) -> None:
    other_store = Store.objects.create(name="Boutique 2")
    empty = Stock.objects.create(store=store, product=product, quantity=0)
    negative = Stock.objects.create(store=other_store, product=product, quantity=-2)

    run_initialization()

    empty.refresh_from_db()
    negative.refresh_from_db()
    assert empty.average_unit_cost == Decimal("350.0000")
    assert negative.average_unit_cost == Decimal("350.0000")
    assert StockCostChange.objects.get(store=other_store).quantity_at_change == Decimal("-2.000")


def test_writes_one_audit_row_per_store(store: Store, product: Product) -> None:
    other_store = Store.objects.create(name="Boutique 2")
    Stock.objects.create(store=store, product=product, quantity=5)
    Stock.objects.create(store=other_store, product=product, quantity=7)

    run_initialization()

    assert StockCostChange.objects.filter(store=store).count() == 1
    assert StockCostChange.objects.filter(store=other_store).count() == 1


def test_running_twice_changes_nothing_more(store: Store, product: Product) -> None:
    Stock.objects.create(store=store, product=product, quantity=10)

    run_initialization()
    run_initialization()

    assert StockCostChange.objects.count() == 1


def test_reverse_forgets_only_what_it_initialized(store: Store, product: Product) -> None:
    other_product = Product.objects.create(name="Riz 5kg", selling_price=Decimal("4500"))
    initialized = Stock.objects.create(store=store, product=product, quantity=10)
    set_by_hand = Stock.objects.create(
        store=store, product=other_product, quantity=3, average_unit_cost=Decimal("4000")
    )
    manual_change = StockCostChange.objects.create(
        store=store,
        product=other_product,
        source=StockCostChange.Source.INITIAL,
        new_cost=Decimal("4000"),
        quantity_at_change=3,
        reason="Saisi par le gérant",
    )
    run_initialization()

    initial_cost_migration.forget_initial_average_cost(django_apps, None)

    initialized.refresh_from_db()
    set_by_hand.refresh_from_db()
    assert initialized.average_unit_cost is None
    assert set_by_hand.average_unit_cost == Decimal("4000.0000")
    assert list(StockCostChange.objects.all()) == [manual_change]


# --- Réception et coût moyen pondéré ---------------------------------------


def _receive(store: Store, product: Product, quantity, unit_cost=None, **kwargs):
    from apps.inventory.services import receive_stock

    return receive_stock(
        store=store, product=product, quantity=quantity, unit_cost=unit_cost, **kwargs
    )


def test_first_receipt_sets_the_cost(store: Store, product: Product) -> None:
    result = _receive(store, product, 10, Decimal("300"))

    assert result.stock.average_unit_cost == Decimal("300.0000")
    assert result.movement.unit_cost == Decimal("300.0000")
    assert result.unit_cost == Decimal("300.0000")


def test_receipts_at_different_costs_give_the_weighted_average(
    store: Store, product: Product
) -> None:
    _receive(store, product, 10, Decimal("300"))
    result = _receive(store, product, 20, Decimal("350"))

    stock = Stock.objects.get(store=store, product=product)
    assert stock.quantity == Decimal("30.000")
    # 10 × 300 + 20 × 350 = 10 000 ; 10 000 / 30 = 333,3333… arrondi à 4 décimales.
    assert stock.average_unit_cost == Decimal("333.3333")
    assert result.movement.unit_cost == Decimal("350.0000")


def test_average_is_rounded_half_up_to_four_decimals(store: Store, product: Product) -> None:
    _receive(store, product, 1, Decimal("0"))
    _receive(store, product, 2, Decimal("1"))

    # 2 / 3 = 0,66666… → 0,6667
    assert Stock.objects.get(store=store, product=product).average_unit_cost == Decimal("0.6667")


def test_weighed_products_average_decimal_quantities(store: Store) -> None:
    rice = Product.objects.create(
        name="Riz au kilo", selling_price=Decimal("600"), sale_unit=Product.SaleUnit.KG
    )
    _receive(store, rice, Decimal("2.500"), Decimal("400"))
    _receive(store, rice, Decimal("7.500"), Decimal("480"))

    # (2,5 × 400 + 7,5 × 480) / 10 = 460
    assert Stock.objects.get(store=store, product=rice).average_unit_cost == Decimal("460.0000")


def test_receipt_into_a_negative_stock_takes_the_lot_cost(store: Store, product: Product) -> None:
    Stock.objects.create(
        store=store, product=product, quantity=-2, average_unit_cost=Decimal("300")
    )

    _receive(store, product, 10, Decimal("350"))

    stock = Stock.objects.get(store=store, product=product)
    assert stock.quantity == Decimal("8.000")
    assert stock.average_unit_cost == Decimal("350.0000")


def test_receipt_into_an_unknown_cost_takes_the_lot_cost(store: Store, product: Product) -> None:
    Stock.objects.create(store=store, product=product, quantity=5)

    _receive(store, product, 10, Decimal("350"))

    assert Stock.objects.get(store=store, product=product).average_unit_cost == Decimal("350.0000")


def test_receipt_without_cost_falls_back_to_the_last_purchase_price(
    store: Store, product: Product
) -> None:
    result = _receive(store, product, 10)

    assert result.stock.average_unit_cost == Decimal("350.0000")
    assert result.movement.unit_cost == Decimal("350.0000")


@pytest.mark.parametrize("purchase_price", [None, Decimal("0.00")])
def test_receipt_without_any_cost_leaves_the_average_unchanged(
    store: Store, product: Product, purchase_price: Decimal | None
) -> None:
    Product.objects.filter(pk=product.pk).update(purchase_price=purchase_price)
    product.refresh_from_db()
    Stock.objects.create(
        store=store, product=product, quantity=5, average_unit_cost=Decimal("300")
    )

    result = _receive(store, product, 10)

    assert result.stock.quantity == Decimal("15.000")
    assert result.stock.average_unit_cost == Decimal("300.0000")
    assert result.movement.unit_cost is None
    assert result.unit_cost is None


def test_receipt_without_any_cost_keeps_an_unknown_cost_unknown(store: Store) -> None:
    unpriced = Product.objects.create(name="Savon", selling_price=Decimal("250"))

    result = _receive(store, unpriced, 10)

    assert result.stock.average_unit_cost is None


def test_receipt_cost_becomes_the_last_purchase_price(store: Store, product: Product) -> None:
    updated_at = product.updated_at

    _receive(store, product, 10, Decimal("365.50"))

    product.refresh_from_db()
    assert product.purchase_price == Decimal("365.50")
    # Rien n'a changé pour le POS : le produit ne repart pas en synchronisation.
    assert product.updated_at == updated_at


def test_free_lot_counts_in_the_average_but_not_as_a_purchase_price(
    store: Store, product: Product
) -> None:
    _receive(store, product, 10, Decimal("300"))
    _receive(store, product, 10, Decimal("0"))

    product.refresh_from_db()
    assert Stock.objects.get(store=store, product=product).average_unit_cost == Decimal("150.0000")
    assert product.purchase_price == Decimal("300.00")


def test_receipt_records_its_author(store: Store, product: Product) -> None:
    manager = User.objects.create_user(username="gerant")

    result = _receive(store, product, 10, Decimal("300"), created_by=manager)

    assert result.movement.created_by == manager


@pytest.mark.parametrize("unit_cost", [Decimal("-1"), "abc", True, Decimal("1.00001"), "NaN"])
def test_receipt_rejects_an_invalid_cost_without_touching_the_stock(
    store: Store, product: Product, unit_cost
) -> None:
    from apps.inventory.exceptions import InvalidStockCost

    Stock.objects.create(
        store=store, product=product, quantity=5, average_unit_cost=Decimal("300")
    )

    with pytest.raises(InvalidStockCost):
        _receive(store, product, 10, unit_cost)

    stock = Stock.objects.get(store=store, product=product)
    assert stock.quantity == Decimal("5.000")
    assert stock.average_unit_cost == Decimal("300.0000")
    assert not InventoryMovement.objects.exists()


def test_costs_are_kept_per_store(store: Store, product: Product) -> None:
    other_store = Store.objects.create(name="Boutique 2")

    _receive(store, product, 10, Decimal("300"))
    _receive(other_store, product, 10, Decimal("400"))

    assert Stock.objects.get(store=store, product=product).average_unit_cost == Decimal("300.0000")
    assert Stock.objects.get(store=other_store, product=product).average_unit_cost == Decimal(
        "400.0000"
    )


# --- Ajustement d'inventaire -------------------------------------------------


@pytest.mark.parametrize("counted", [15, 5])
def test_adjustment_keeps_the_average_and_values_the_gap_at_it(
    store: Store, product: Product, counted: int
) -> None:
    from apps.inventory.services import adjust_stock

    manager = User.objects.create_user(username="gerant")
    Stock.objects.create(
        store=store, product=product, quantity=10, average_unit_cost=Decimal("333.3333")
    )

    result = adjust_stock(
        store=store, product=product, counted_quantity=counted, created_by=manager
    )

    assert result.stock.average_unit_cost == Decimal("333.3333")
    assert result.movement.unit_cost == Decimal("333.3333")
    assert result.movement.created_by == manager


def test_adjustment_of_an_unknown_cost_stays_unknown(store: Store, product: Product) -> None:
    from apps.inventory.services import adjust_stock

    Stock.objects.create(store=store, product=product, quantity=10)

    result = adjust_stock(store=store, product=product, counted_quantity=12)

    assert result.stock.average_unit_cost is None
    assert result.movement.unit_cost is None


# --- API d'entrée de stock ---------------------------------------------------


@pytest.fixture
def api_client():
    from rest_framework.test import APIClient

    from django.contrib.auth.models import Permission

    manager = User.objects.create_user(username="gerant")
    manager.user_permissions.add(Permission.objects.get(codename="change_product"))
    client = APIClient()
    client.force_authenticate(manager)
    return client


def _stock_in(api_client, store: Store, product: Product, **extra):
    from django.urls import reverse

    return api_client.post(
        reverse("inventory-stock-in"),
        {"store_id": str(store.pk), "product_id": str(product.pk), "quantity": "10", **extra},
        format="json",
    )


def test_api_stock_in_applies_the_given_cost(api_client, store: Store, product: Product) -> None:
    response = _stock_in(api_client, store, product, unit_cost="320.5")

    assert response.status_code == 201
    stock = Stock.objects.get(store=store, product=product)
    assert stock.average_unit_cost == Decimal("320.5000")
    movement = InventoryMovement.objects.get()
    assert movement.unit_cost == Decimal("320.5000")
    assert movement.created_by.username == "gerant"


def test_api_stock_in_without_cost_uses_the_last_purchase_price(
    api_client, store: Store, product: Product
) -> None:
    response = _stock_in(api_client, store, product)

    assert response.status_code == 201
    assert Stock.objects.get(store=store, product=product).average_unit_cost == Decimal("350.0000")


def test_api_stock_in_rejects_a_negative_cost(api_client, store: Store, product: Product) -> None:
    response = _stock_in(api_client, store, product, unit_cost="-1")

    assert response.status_code == 400
    assert not Stock.objects.exists()


def test_api_stock_in_is_refused_to_a_cashier(store: Store, product: Product) -> None:
    from rest_framework.test import APIClient

    cashier_client = APIClient()
    cashier_client.force_authenticate(User.objects.create_user(username="caissier"))

    response = _stock_in(cashier_client, store, product, unit_cost="1")

    assert response.status_code == 403
    assert not Stock.objects.exists()
    assert not InventoryMovement.objects.exists()
