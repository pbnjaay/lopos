from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone

from apps.cash.models import CashSession
from apps.catalog.models import Product
from apps.dashboard.formatting import (
    classify_cash_difference,
    format_cash_difference,
    format_count,
    format_fcfa,
    format_percentage,
)
from apps.dashboard.services import get_manager_dashboard
from apps.inventory.models import Stock
from apps.sales.models import Payment, Sale, SaleItem
from apps.stores.models import CashRegister, Store
from apps.sync.models import ProcessedSyncEvent


pytestmark = pytest.mark.django_db
User = get_user_model()


@pytest.fixture
def cashier():
    return User.objects.create_user(username="cashier")


@pytest.fixture
def store() -> Store:
    return Store.objects.create(name="Supérette Louga")


@pytest.fixture
def store2() -> Store:
    return Store.objects.create(name="Supérette Dakar")


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
    occurred_at=None,
) -> Sale:
    sale = Sale.objects.create(
        cash_session=cash_session,
        cashier=cashier,
        subtotal=total,
        discount=Decimal("0.00"),
        total=total,
        status=status,
        **({"occurred_at": occurred_at} if occurred_at else {}),
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


# --- Period filtering ---------------------------------------------------


def test_today_period_excludes_yesterdays_sales(cash_session: CashSession, cashier) -> None:
    yesterday = timezone.localtime() - timezone.timedelta(days=1)
    make_sale(
        cash_session=cash_session,
        cashier=cashier,
        total=Decimal("1000.00"),
        method=Payment.Method.CASH,
        occurred_at=yesterday,
    )
    make_sale(
        cash_session=cash_session,
        cashier=cashier,
        total=Decimal("2000.00"),
        method=Payment.Method.CASH,
    )

    dashboard = get_manager_dashboard(period="today")

    assert dashboard.gross_sales == Decimal("2000.00")
    assert dashboard.sales_count == 1


def test_yesterday_period_only_includes_yesterdays_sales(
    cash_session: CashSession, cashier
) -> None:
    yesterday = timezone.localtime() - timezone.timedelta(days=1)
    make_sale(
        cash_session=cash_session,
        cashier=cashier,
        total=Decimal("1000.00"),
        method=Payment.Method.CASH,
        occurred_at=yesterday,
    )
    make_sale(
        cash_session=cash_session,
        cashier=cashier,
        total=Decimal("2000.00"),
        method=Payment.Method.CASH,
    )

    dashboard = get_manager_dashboard(period="yesterday")

    assert dashboard.gross_sales == Decimal("1000.00")
    assert dashboard.sales_count == 1


def test_last_7_days_period_includes_both(cash_session: CashSession, cashier) -> None:
    three_days_ago = timezone.localtime() - timezone.timedelta(days=3)
    make_sale(
        cash_session=cash_session,
        cashier=cashier,
        total=Decimal("1000.00"),
        method=Payment.Method.CASH,
        occurred_at=three_days_ago,
    )
    make_sale(
        cash_session=cash_session,
        cashier=cashier,
        total=Decimal("2000.00"),
        method=Payment.Method.CASH,
    )

    dashboard = get_manager_dashboard(period="7d")

    assert dashboard.gross_sales == Decimal("3000.00")
    assert dashboard.sales_count == 2


def test_last_7_days_period_excludes_sales_older_than_a_week(
    cash_session: CashSession, cashier
) -> None:
    ten_days_ago = timezone.localtime() - timezone.timedelta(days=10)
    make_sale(
        cash_session=cash_session,
        cashier=cashier,
        total=Decimal("1000.00"),
        method=Payment.Method.CASH,
        occurred_at=ten_days_ago,
    )

    dashboard = get_manager_dashboard(period="7d")

    assert dashboard.gross_sales == Decimal("0.00")
    assert dashboard.sales_count == 0


# --- Store filtering ------------------------------------------------------


def test_store_filter_scopes_sales_to_a_single_store(
    store: Store, store2: Store, cashier
) -> None:
    register1 = CashRegister.objects.create(store=store, name="Caisse 01")
    session1 = CashSession.objects.create(
        cash_register=register1, cashier=cashier, opening_balance=Decimal("0.00")
    )
    register2 = CashRegister.objects.create(store=store2, name="Caisse 01")
    session2 = CashSession.objects.create(
        cash_register=register2, cashier=cashier, opening_balance=Decimal("0.00")
    )

    make_sale(cash_session=session1, cashier=cashier, total=Decimal("1000.00"), method=Payment.Method.CASH)
    make_sale(cash_session=session2, cashier=cashier, total=Decimal("5000.00"), method=Payment.Method.CASH)

    dashboard = get_manager_dashboard(store_id=str(store.pk))

    assert dashboard.gross_sales == Decimal("1000.00")
    assert dashboard.sales_count == 1


def test_unknown_store_id_falls_back_to_all_stores(cash_session: CashSession, cashier) -> None:
    make_sale(cash_session=cash_session, cashier=cashier, total=Decimal("1000.00"), method=Payment.Method.CASH)

    dashboard = get_manager_dashboard(store_id="00000000-0000-0000-0000-000000000000")

    assert dashboard.store_id is None
    assert dashboard.sales_count == 1


# --- Payment totals / percentages / basket --------------------------------


def test_gross_sales_and_payment_totals(cash_session: CashSession, cashier) -> None:
    make_sale(cash_session=cash_session, cashier=cashier, total=Decimal("10000.00"), method=Payment.Method.CASH)
    make_sale(cash_session=cash_session, cashier=cashier, total=Decimal("20000.00"), method=Payment.Method.WAVE)
    make_sale(cash_session=cash_session, cashier=cashier, total=Decimal("5000.00"), method=Payment.Method.ORANGE_MONEY)

    dashboard = get_manager_dashboard()

    assert dashboard.gross_sales == Decimal("35000.00")
    assert dashboard.sales_count == 3
    assert dashboard.payment_totals == {
        "cash": Decimal("10000.00"),
        "wave": Decimal("20000.00"),
        "orange_money": Decimal("5000.00"),
    }
    assert dashboard.payment_percentages == {"cash": 29, "wave": 57, "orange_money": 14}


def test_payment_percentages_example_from_spec(cash_session: CashSession, cashier) -> None:
    make_sale(cash_session=cash_session, cashier=cashier, total=Decimal("50000.00"), method=Payment.Method.CASH)
    make_sale(cash_session=cash_session, cashier=cashier, total=Decimal("30000.00"), method=Payment.Method.WAVE)
    make_sale(cash_session=cash_session, cashier=cashier, total=Decimal("20000.00"), method=Payment.Method.ORANGE_MONEY)

    dashboard = get_manager_dashboard()

    assert dashboard.payment_percentages == {"cash": 50, "wave": 30, "orange_money": 20}


def test_average_basket(cash_session: CashSession, cashier) -> None:
    for _ in range(3):
        make_sale(cash_session=cash_session, cashier=cashier, total=Decimal("10000.00"), method=Payment.Method.CASH)

    dashboard = get_manager_dashboard()

    assert dashboard.average_basket == Decimal("10000.00")


def test_average_basket_and_percentages_are_zero_without_sales() -> None:
    dashboard = get_manager_dashboard()

    assert dashboard.sales_count == 0
    assert dashboard.average_basket == Decimal("0.00")
    assert dashboard.payment_percentages == {"cash": 0, "wave": 0, "orange_money": 0}


# --- Top products -----------------------------------------------------


def test_top_products_ordered_by_quantity_sold(cash_session: CashSession, cashier) -> None:
    coca = Product.objects.create(name="Coca", selling_price=Decimal("500.00"))
    pain = Product.objects.create(name="Pain", selling_price=Decimal("200.00"))
    eau = Product.objects.create(name="Eau", selling_price=Decimal("300.00"))

    sale = make_sale(cash_session=cash_session, cashier=cashier, total=Decimal("6300.00"), method=Payment.Method.CASH)
    SaleItem.objects.create(sale=sale, product=coca, product_name=coca.name, unit_price=coca.selling_price, quantity=5, line_total=Decimal("2500.00"))
    SaleItem.objects.create(sale=sale, product=pain, product_name=pain.name, unit_price=pain.selling_price, quantity=8, line_total=Decimal("1600.00"))
    SaleItem.objects.create(sale=sale, product=eau, product_name=eau.name, unit_price=eau.selling_price, quantity=3, line_total=Decimal("900.00"))

    dashboard = get_manager_dashboard()

    assert [item.name for item in dashboard.top_products] == ["Pain", "Coca", "Eau"]
    assert dashboard.top_products[0].url.endswith(f"/catalog/product/{pain.pk}/change/")


def test_cancelled_sales_are_excluded_from_dashboard(cash_session: CashSession, cashier) -> None:
    product = Product.objects.create(name="Coca", selling_price=Decimal("500.00"))
    cancelled_sale = make_sale(
        cash_session=cash_session, cashier=cashier, total=Decimal("5000.00"),
        method=Payment.Method.CASH, status=Sale.Status.CANCELLED,
    )
    SaleItem.objects.create(sale=cancelled_sale, product=product, product_name=product.name, unit_price=product.selling_price, quantity=10, line_total=Decimal("5000.00"))

    dashboard = get_manager_dashboard()

    assert dashboard.gross_sales == Decimal("0.00")
    assert dashboard.sales_count == 0
    assert dashboard.top_products == []


# --- Stock: rupture vs faible -------------------------------------------


@pytest.mark.parametrize(
    ("quantity", "expected_out", "expected_low"),
    [(0, 1, 0), (2, 0, 1), (5, 0, 1), (10, 0, 0)],
)
def test_out_of_stock_and_low_stock_are_distinct(
    store: Store, quantity: int, expected_out: int, expected_low: int
) -> None:
    product = Product.objects.create(name="Lait", selling_price=Decimal("600.00"))
    Stock.objects.create(store=store, product=product, quantity=quantity)

    dashboard = get_manager_dashboard()

    assert dashboard.low_stock_threshold == 5
    assert dashboard.out_of_stock_count == expected_out
    assert dashboard.low_stock_count == expected_low


# --- Cash discrepancy formatting / classification -----------------------


@pytest.mark.parametrize(
    ("difference", "expected"),
    [
        (Decimal("0"), "Aucun écart"),
        (None, "Aucun écart"),
        (Decimal("500"), "Surplus : 500 FCFA"),
        (Decimal("-500"), "Manque : 500 FCFA"),
        (Decimal("-20100"), "Manque : 20 100 FCFA"),
    ],
)
def test_format_cash_difference_never_shows_a_negative_manque(difference, expected) -> None:
    assert format_cash_difference(difference) == expected


@pytest.mark.parametrize(
    ("difference", "expected_severity"),
    [
        (Decimal("500"), "info"),
        (Decimal("-500"), "info"),
        (Decimal("3000"), "warning"),
        (Decimal("-3000"), "warning"),
        (Decimal("6000"), "critical"),
        (Decimal("-20100"), "critical"),
    ],
)
def test_classify_cash_difference(difference, expected_severity) -> None:
    assert classify_cash_difference(difference) == expected_severity


def test_cash_alerts_prioritize_critical_shortages(cash_session: CashSession, cashier) -> None:
    register = cash_session.cash_register
    closed_at = timezone.now()

    CashSession.objects.create(
        cash_register=register, cashier=cashier, opening_balance=Decimal("0"),
        status=CashSession.Status.CLOSED, closing_balance=Decimal("0"),
        expected_balance=Decimal("20100"), difference=Decimal("-20100"), closed_at=closed_at,
    )
    other_register = CashRegister.objects.create(store=register.store, name="Caisse 02")
    CashSession.objects.create(
        cash_register=other_register, cashier=cashier, opening_balance=Decimal("0"),
        status=CashSession.Status.CLOSED, closing_balance=Decimal("3500"),
        expected_balance=Decimal("0"), difference=Decimal("3500"), closed_at=closed_at,
    )

    dashboard = get_manager_dashboard()

    assert dashboard.alerts[0].severity == "critical"
    assert "Manque : 20 100 FCFA" in dashboard.alerts[0].text
    assert any("Surplus : 3 500 FCFA" in alert.text for alert in dashboard.alerts)


def test_no_alerts_when_nothing_significant() -> None:
    dashboard = get_manager_dashboard()

    assert dashboard.alerts == []


# --- Sync conflicts ------------------------------------------------------


def test_sync_conflict_alert_only_appears_when_flagged() -> None:
    dashboard = get_manager_dashboard()
    assert not any("vérification de synchronisation" in a.text for a in dashboard.alerts)

    ProcessedSyncEvent.objects.create(
        event_id="11111111-1111-1111-1111-111111111111",
        terminal_id="22222222-2222-2222-2222-222222222222",
        event_type=ProcessedSyncEvent.EventType.SALE_COMPLETED,
        entity_id="33333333-3333-3333-3333-333333333333",
        stock_discrepancy=True,
    )

    dashboard = get_manager_dashboard()
    assert any("vérification de synchronisation" in a.text for a in dashboard.alerts)


# --- Helpers --------------------------------------------------------------


@pytest.mark.parametrize(
    ("amount", "expected"),
    [(0, "0 FCFA"), (None, "0 FCFA"), (500, "500 FCFA"), (125000, "125 000 FCFA")],
)
def test_format_fcfa(amount, expected) -> None:
    assert format_fcfa(amount) == expected


@pytest.mark.parametrize(
    ("count", "expected"),
    [(1, "1 produit"), (2, "2 produits"), (0, "0 produits")],
)
def test_format_count(count, expected) -> None:
    assert format_count(count, "produit", "produits") == expected


def test_format_percentage_avoids_division_by_zero() -> None:
    assert format_percentage(Decimal("100"), 0) == 0
    assert format_percentage(Decimal("50"), Decimal("100")) == 50


# --- Performance ------------------------------------------------------


def test_dashboard_query_count_stays_bounded(
    django_assert_max_num_queries, cash_session: CashSession, cashier
) -> None:
    coca = Product.objects.create(name="Coca", selling_price=Decimal("500.00"))
    Stock.objects.create(store=cash_session.cash_register.store, product=coca, quantity=2)

    for _ in range(5):
        sale = make_sale(cash_session=cash_session, cashier=cashier, total=Decimal("500.00"), method=Payment.Method.CASH)
        SaleItem.objects.create(sale=sale, product=coca, product_name=coca.name, unit_price=coca.selling_price, quantity=1, line_total=Decimal("500.00"))

    with django_assert_max_num_queries(15):
        get_manager_dashboard()
