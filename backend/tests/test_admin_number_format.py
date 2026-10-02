"""Les montants et quantités de l'admin se lisent comme sur le POS.

Sans formatage, Django affiche les décimaux tels que stockés : « 25000,00 »
pour un montant, « 6,000 » pour six unités (lu « six mille »).
"""

from decimal import Decimal
from uuid import uuid4

import pytest
from django.contrib.auth import get_user_model
from django.urls import reverse

from apps.cash.models import CashSession
from apps.catalog.models import Product
from apps.dashboard.formatting import format_quantity
from apps.expenses.models import ExpenseCategory
from apps.expenses.services import create_expense
from apps.inventory.models import InventoryMovement, Stock
from apps.inventory.services import receive_stock
from apps.sales.models import Payment
from apps.sales.services import complete_sale
from apps.stores.models import CashRegister, Store


pytestmark = pytest.mark.django_db
User = get_user_model()


@pytest.mark.parametrize(
    "quantity, unit, expected",
    [
        (Decimal("6.000"), "UNIT", "6"),
        (Decimal("1250"), "UNIT", "1 250"),
        (Decimal("18.250"), "KG", "18,25 kg"),
        (Decimal("0.300"), "KG", "0,3 kg"),
        (Decimal("2.000"), "KG", "2 kg"),
        (Decimal("-2.000"), "UNIT", "-2"),
        (Decimal("0.000"), None, "0"),
        (None, "UNIT", "—"),
    ],
)
def test_format_quantity(quantity, unit, expected) -> None:
    assert format_quantity(quantity, unit) == expected


@pytest.fixture
def admin_client(client):
    client.force_login(User.objects.create_superuser(username="admin", password="x"))
    return client


@pytest.fixture
def store() -> Store:
    return Store.objects.create(name="Supérette Louga")


@pytest.fixture
def session(store: Store) -> CashSession:
    cashier = User.objects.create_user(username="caissier")
    register = CashRegister.objects.create(store=store, name="Caisse 01")
    return CashSession.objects.create(
        cash_register=register, cashier=cashier, opening_balance=Decimal("50000")
    )


@pytest.fixture
def banana(store: Store) -> Product:
    product = Product.objects.create(
        name="Banane", selling_price=Decimal("1200"), sale_unit=Product.SaleUnit.KG
    )
    receive_stock(store=store, product=product, quantity=Decimal("18.250"), unit_cost=Decimal("800"))
    return product


@pytest.fixture
def coca(store: Store) -> Product:
    product = Product.objects.create(name="Coca 50cl", selling_price=Decimal("500"))
    receive_stock(store=store, product=product, quantity=6, unit_cost=Decimal("350"))
    return product


def _assert_no_raw_numbers(content: str, *raw: str) -> None:
    for value in raw:
        assert value not in content, value


def test_sale_page_shows_amounts_in_fcfa_and_quantities_by_unit(
    admin_client, session: CashSession, coca: Product, banana: Product
) -> None:
    sale = complete_sale(
        cash_session=session,
        items=[
            {"product_id": coca.id, "quantity": Decimal("2"), "unit_price": None},
            {"product_id": banana.id, "quantity": Decimal("0.5"), "unit_price": None},
        ],
        payments=[
            {
                "method": Payment.Method.CASH,
                "amount": Decimal("1600"),
                "received_amount": Decimal("2000"),
            }
        ],
    )

    content = admin_client.get(reverse("admin:sales_sale_change", args=[sale.pk])).content.decode()

    assert "1 600 FCFA" in content
    assert "0,5 kg" in content
    assert "400 FCFA" in content  # monnaie rendue
    _assert_no_raw_numbers(content, "1600,00", "2,000", "0,500", "2000,00")


def test_stock_lists_show_readable_quantities(
    admin_client, coca: Product, banana: Product
) -> None:
    stock_page = admin_client.get(reverse("admin:inventory_stock_changelist")).content.decode()
    movements = admin_client.get(
        reverse("admin:inventory_inventorymovement_changelist")
    ).content.decode()
    valuation = admin_client.get(
        reverse("admin:inventory_stockvaluation_changelist")
    ).content.decode()

    assert "18,25 kg" in stock_page
    assert "+6" in movements
    assert "+18,25 kg" in movements
    assert "18,25 kg" in valuation
    for content in (stock_page, movements, valuation):
        _assert_no_raw_numbers(content, "6,000", "18,250")


def test_stock_and_movement_pages_hide_raw_model_values(
    admin_client, store: Store, coca: Product
) -> None:
    stock = Stock.objects.get(store=store, product=coca)
    movement = InventoryMovement.objects.get(product=coca)

    stock_page = admin_client.get(reverse("admin:inventory_stock_change", args=[stock.pk]))
    movement_page = admin_client.get(
        reverse("admin:inventory_inventorymovement_change", args=[movement.pk])
    )

    for response in (stock_page, movement_page):
        assert response.status_code == 200
        _assert_no_raw_numbers(response.content.decode(), "6,000", "350,0000")
    assert "350 FCFA" in movement_page.content.decode()


def test_product_page_shows_stock_per_store_by_unit(admin_client, banana: Product) -> None:
    content = admin_client.get(
        reverse("admin:catalog_product_change", args=[banana.pk])
    ).content.decode()

    assert "18,25 kg" in content
    _assert_no_raw_numbers(content, "18.250", "18,250")


def test_expense_page_shows_its_amount_in_fcfa(admin_client, session: CashSession) -> None:
    expense = create_expense(
        cash_session=session,
        created_by=session.cashier,
        category=ExpenseCategory.objects.get(name="Autre"),
        amount=Decimal("25000"),
        payment_method=Payment.Method.WAVE,
        description="Loyer",
        idempotency_key=uuid4(),
    )

    content = admin_client.get(
        reverse("admin:expenses_expense_change", args=[expense.pk])
    ).content.decode()

    assert "25 000 FCFA" in content
    _assert_no_raw_numbers(content, "25000,00")


def test_cash_session_page_shows_balances_in_fcfa(admin_client, session: CashSession) -> None:
    content = admin_client.get(
        reverse("admin:cash_cashsession_change", args=[session.pk])
    ).content.decode()

    assert "50 000 FCFA" in content
    _assert_no_raw_numbers(content, "50000,00")
