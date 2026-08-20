from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model

from apps.cash.models import CashSession
from apps.catalog.models import Product
from apps.dashboard.formatting import format_fcfa
from apps.dashboard.services import get_manager_dashboard
from apps.inventory.models import Stock
from apps.sales.models import Payment, Sale, SaleItem
from apps.stores.models import CashRegister, Store


pytestmark = pytest.mark.django_db
User = get_user_model()


@pytest.fixture
def cashier():
    return User.objects.create_user(username="cashier")


@pytest.fixture
def store() -> Store:
    return Store.objects.create(name="Supérette Test")


@pytest.fixture
def cash_session(store: Store, cashier) -> CashSession:
    register = CashRegister.objects.create(store=store, name="Caisse 01")
    return CashSession.objects.create(
        cash_register=register,
        cashier=cashier,
        opening_balance=Decimal("15000.00"),
    )


def make_sale(
    *,
    cash_session: CashSession,
    cashier,
    total: Decimal,
    method: str,
    status: str = Sale.Status.COMPLETED,
) -> Sale:
    sale = Sale.objects.create(
        cash_session=cash_session,
        cashier=cashier,
        subtotal=total,
        discount=Decimal("0.00"),
        total=total,
        status=status,
    )
    if method == Payment.Method.CASH:
        Payment.objects.create(
            sale=sale,
            method=method,
            amount=total,
            received_amount=total,
            change_amount=Decimal("0.00"),
        )
    else:
        Payment.objects.create(sale=sale, method=method, amount=total)
    return sale


def test_gross_sales_and_payment_totals(cash_session: CashSession, cashier) -> None:
    make_sale(
        cash_session=cash_session,
        cashier=cashier,
        total=Decimal("10000.00"),
        method=Payment.Method.CASH,
    )
    make_sale(
        cash_session=cash_session,
        cashier=cashier,
        total=Decimal("20000.00"),
        method=Payment.Method.WAVE,
    )
    make_sale(
        cash_session=cash_session,
        cashier=cashier,
        total=Decimal("5000.00"),
        method=Payment.Method.ORANGE_MONEY,
    )

    dashboard = get_manager_dashboard()

    assert dashboard.gross_sales_today == Decimal("35000.00")
    assert dashboard.sales_count_today == 3
    assert dashboard.payment_totals == {
        "cash": Decimal("10000.00"),
        "wave": Decimal("20000.00"),
        "orange_money": Decimal("5000.00"),
    }


def test_average_basket(cash_session: CashSession, cashier) -> None:
    for _ in range(3):
        make_sale(
            cash_session=cash_session,
            cashier=cashier,
            total=Decimal("10000.00"),
            method=Payment.Method.CASH,
        )

    dashboard = get_manager_dashboard()

    assert dashboard.average_basket == Decimal("10000.00")


def test_average_basket_is_zero_without_sales() -> None:
    dashboard = get_manager_dashboard()

    assert dashboard.sales_count_today == 0
    assert dashboard.average_basket == Decimal("0.00")


def test_top_products_ordered_by_quantity_sold(cash_session: CashSession, cashier) -> None:
    coca = Product.objects.create(name="Coca", selling_price=Decimal("500.00"))
    pain = Product.objects.create(name="Pain", selling_price=Decimal("200.00"))
    eau = Product.objects.create(name="Eau", selling_price=Decimal("300.00"))

    sale = make_sale(
        cash_session=cash_session,
        cashier=cashier,
        total=Decimal("6300.00"),
        method=Payment.Method.CASH,
    )
    SaleItem.objects.create(
        sale=sale,
        product=coca,
        product_name=coca.name,
        unit_price=coca.selling_price,
        quantity=5,
        line_total=Decimal("2500.00"),
    )
    SaleItem.objects.create(
        sale=sale,
        product=pain,
        product_name=pain.name,
        unit_price=pain.selling_price,
        quantity=8,
        line_total=Decimal("1600.00"),
    )
    SaleItem.objects.create(
        sale=sale,
        product=eau,
        product_name=eau.name,
        unit_price=eau.selling_price,
        quantity=3,
        line_total=Decimal("900.00"),
    )

    dashboard = get_manager_dashboard()

    assert [item.name for item in dashboard.top_products] == ["Pain", "Coca", "Eau"]


def test_cancelled_sales_are_excluded_from_dashboard(
    cash_session: CashSession, cashier
) -> None:
    product = Product.objects.create(name="Coca", selling_price=Decimal("500.00"))
    cancelled_sale = make_sale(
        cash_session=cash_session,
        cashier=cashier,
        total=Decimal("5000.00"),
        method=Payment.Method.CASH,
        status=Sale.Status.CANCELLED,
    )
    SaleItem.objects.create(
        sale=cancelled_sale,
        product=product,
        product_name=product.name,
        unit_price=product.selling_price,
        quantity=10,
        line_total=Decimal("5000.00"),
    )

    dashboard = get_manager_dashboard()

    assert dashboard.gross_sales_today == Decimal("0.00")
    assert dashboard.sales_count_today == 0
    assert dashboard.top_products == []


@pytest.mark.parametrize(
    ("quantity", "expected_low_stock"),
    [(0, True), (2, True), (5, True), (10, False)],
)
def test_low_stock_threshold(
    store: Store, quantity: int, expected_low_stock: bool
) -> None:
    product = Product.objects.create(name="Lait", selling_price=Decimal("600.00"))
    Stock.objects.create(store=store, product=product, quantity=quantity)

    dashboard = get_manager_dashboard()

    assert dashboard.low_stock_threshold == 5
    assert (dashboard.low_stock_count == 1) is expected_low_stock


@pytest.mark.parametrize(
    ("amount", "expected"),
    [(0, "0 FCFA"), (None, "0 FCFA"), (500, "500 FCFA"), (125000, "125 000 FCFA")],
)
def test_format_fcfa(amount, expected) -> None:
    assert format_fcfa(amount) == expected


def test_dashboard_query_count_stays_bounded(
    django_assert_max_num_queries, cash_session: CashSession, cashier
) -> None:
    coca = Product.objects.create(name="Coca", selling_price=Decimal("500.00"))
    Stock.objects.create(store=cash_session.cash_register.store, product=coca, quantity=2)

    for _ in range(5):
        sale = make_sale(
            cash_session=cash_session,
            cashier=cashier,
            total=Decimal("500.00"),
            method=Payment.Method.CASH,
        )
        SaleItem.objects.create(
            sale=sale,
            product=coca,
            product_name=coca.name,
            unit_price=coca.selling_price,
            quantity=1,
            line_total=Decimal("500.00"),
        )

    with django_assert_max_num_queries(10):
        get_manager_dashboard()
