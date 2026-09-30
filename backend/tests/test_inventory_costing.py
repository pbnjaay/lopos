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
