from datetime import timedelta
from decimal import Decimal
from uuid import uuid4

import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone

from apps.cash.models import CashSession
from apps.catalog.models import Product
from apps.customers.services import create_customer, record_customer_payment
from apps.dashboard.profitability import get_profitability_summary
from apps.dashboard.services import get_manager_dashboard
from apps.expenses.models import Expense, ExpenseCategory
from apps.expenses.services import cancel_expense, create_expense
from apps.inventory.models import Stock
from apps.sales.models import Payment, Sale, SaleReturn
from apps.sales.services import cancel_sale, complete_sale, create_sale_return
from apps.stores.models import CashRegister, Store


pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def no_manager_approval_threshold(settings):
    """Ce module teste le cahier et le tiroir, pas la validation par un
    gérant (voir test_cashier_approvals) : seuil hors d'atteinte."""
    settings.APPROVAL_AMOUNT_THRESHOLD = Decimal("1000000000")


User = get_user_model()


@pytest.fixture
def cashier():
    return User.objects.create_user(username="cashier", password="secret")


@pytest.fixture
def store() -> Store:
    return Store.objects.create(name="Supérette Test")


def _open_session(store: Store, cashier) -> CashSession:
    register = CashRegister.objects.create(store=store, name=f"Caisse {store.name}")
    return CashSession.objects.create(
        cash_register=register, cashier=cashier, opening_balance=Decimal("50000.00")
    )


@pytest.fixture
def session(store: Store, cashier) -> CashSession:
    return _open_session(store, cashier)


def _product(store: Store, name: str, price, cost, quantity=100) -> Product:
    product = Product.objects.create(name=name, selling_price=Decimal(price))
    Stock.objects.create(
        store=store,
        product=product,
        quantity=Decimal(quantity),
        average_unit_cost=None if cost is None else Decimal(cost),
    )
    return product


def _sell(session: CashSession, product: Product, quantity, unit_price=None, **kwargs) -> Sale:
    price = Decimal(unit_price) if unit_price is not None else product.selling_price
    total = (price * Decimal(quantity)).quantize(Decimal("0.01"))
    payments = kwargs.pop(
        "payments", [{"method": Payment.Method.WAVE, "amount": total}]
    )
    return complete_sale(
        cash_session=session,
        items=[
            {
                "product_id": product.id,
                "quantity": Decimal(quantity),
                "unit_price": None if unit_price is None else Decimal(unit_price),
            }
        ],
        payments=payments,
        **kwargs,
    )


def _return(sale: Sale, session: CashSession, cashier, quantity, restock: bool) -> SaleReturn:
    return create_sale_return(
        original_sale=sale,
        cash_session=session,
        created_by=cashier,
        payment_method=Payment.Method.WAVE,
        idempotency_key=uuid4(),
        items=[
            {"sale_item_id": sale.items.get().id, "quantity": Decimal(quantity), "restock": restock}
        ],
    )


def _expense(session: CashSession, cashier, amount) -> Expense:
    return create_expense(
        cash_session=session,
        created_by=cashier,
        category=ExpenseCategory.objects.get(name="Autre"),
        amount=Decimal(amount),
        payment_method=Payment.Method.WAVE,
        description="Test",
        idempotency_key=uuid4(),
    )


def _today(store_id=None, **kwargs):
    now = timezone.now()
    return get_profitability_summary(
        start=now - timedelta(hours=1), end=now + timedelta(hours=1), store_id=store_id, **kwargs
    )


# --- Cas de référence (spécification 62 à 71) ---------------------------------


def test_62_margin_of_a_sale_at_a_weighted_average_cost(session, store) -> None:
    coca = _product(store, "Coca 50cl", "500", "333.3333")

    _sell(session, coca, 2)

    summary = _today()
    assert summary.revenue == Decimal("1000.00")
    assert summary.cost_of_goods_sold == Decimal("666.67")
    assert summary.gross_margin == Decimal("333.33")
    assert summary.coverage_percent == 100
    assert summary.is_complete


def test_63_margin_uses_the_price_actually_charged(session, store) -> None:
    soda = _product(store, "Fanta", "500", "300")

    _sell(session, soda, 1, unit_price="450")

    summary = _today()
    assert summary.revenue == Decimal("450.00")
    assert summary.gross_margin == Decimal("150.00")


def test_64_restocked_return_cancels_revenue_and_cost(session, store, cashier) -> None:
    rice = _product(store, "Riz 25kg", "5000", "4000")
    sale = _sell(session, rice, 1)

    _return(sale, session, cashier, "1", restock=True)

    summary = _today()
    assert summary.revenue == Decimal("0.00")
    assert summary.cost_of_goods_sold == Decimal("0.00")
    assert summary.gross_margin == Decimal("0.00")
    assert summary.unrestocked_return_cost == Decimal("0.00")


def test_65_return_without_restock_keeps_the_cost_as_a_loss(session, store, cashier) -> None:
    rice = _product(store, "Riz 25kg", "5000", "4000")
    sale = _sell(session, rice, 1)

    _return(sale, session, cashier, "1", restock=False)

    summary = _today()
    assert summary.revenue == Decimal("0.00")
    assert summary.cost_of_goods_sold == Decimal("4000.00")
    assert summary.unrestocked_return_cost == Decimal("4000.00")
    assert summary.gross_margin == Decimal("-4000.00")


def test_66_credit_sale_counts_its_total_not_the_cash_received(session, store) -> None:
    tv = _product(store, "Télévision", "10000", "7000")
    customer = create_customer(store=store, name="Moussa Fall", phone=None)

    _sell(
        session,
        tv,
        1,
        customer_id=customer.id,
        credit_amount=Decimal("6000"),
        payments=[
            {
                "method": Payment.Method.CASH,
                "amount": Decimal("4000"),
                "received_amount": Decimal("4000"),
            }
        ],
    )

    summary = _today()
    assert summary.revenue == Decimal("10000.00")
    assert summary.gross_margin == Decimal("3000.00")
    assert get_manager_dashboard(period="today").payment_totals["cash"] == Decimal("4000.00")


def test_67_customer_repayment_adds_no_revenue_and_no_margin(session, store, cashier) -> None:
    tv = _product(store, "Télévision", "10000", "7000")
    customer = create_customer(store=store, name="Moussa Fall", phone=None)
    sale = _sell(
        session,
        tv,
        1,
        customer_id=customer.id,
        credit_amount=Decimal("10000"),
        payments=[],
    )
    Sale.objects.filter(pk=sale.pk).update(occurred_at=timezone.now() - timedelta(days=1))

    record_customer_payment(
        customer=customer,
        cash_session=session,
        created_by=cashier,
        method=Payment.Method.CASH,
        amount=Decimal("6000"),
        received_amount=Decimal("6000"),
        idempotency_key=uuid4(),
    )

    summary = _today()
    assert summary.revenue == Decimal("0.00")
    assert summary.gross_margin == Decimal("0.00")
    assert get_manager_dashboard(period="today").book.payments_received == Decimal("6000.00")


def test_68_estimated_result_is_gross_margin_minus_expenses(session, store, cashier) -> None:
    fridge = _product(store, "Réfrigérateur", "50000", "20000")
    _sell(session, fridge, 1)

    _expense(session, cashier, "5000")

    summary = _today()
    assert summary.gross_margin == Decimal("30000.00")
    assert summary.expenses == Decimal("5000.00")
    assert summary.estimated_result == Decimal("25000.00")


def test_69_missing_cost_is_excluded_and_flagged(session, store) -> None:
    coca = _product(store, "Coca 50cl", "500", "300")
    soap = _product(store, "Savon", "250", None)

    _sell(session, coca, 4)  # 2 000, coût 1 200
    _sell(session, soap, 2)  # 500, coût inconnu

    summary = _today()
    assert summary.revenue == Decimal("2500.00")
    assert summary.covered_revenue == Decimal("2000.00")
    assert summary.uncovered_revenue == Decimal("500.00")
    # Le savon ne compte jamais à coût 0 : sa vente n'entre pas dans la marge.
    assert summary.cost_of_goods_sold == Decimal("1200.00")
    assert summary.gross_margin == Decimal("800.00")
    assert summary.coverage_percent == 80
    assert not summary.is_complete
    assert summary.has_cost_data


def test_70_cancelled_expense_does_not_reduce_the_result(session, store, cashier) -> None:
    fridge = _product(store, "Réfrigérateur", "50000", "20000")
    _sell(session, fridge, 1)
    expense = _expense(session, cashier, "5000")

    cancel_expense(expense=expense, cancelled_by=cashier, reason="Saisie en double")

    summary = _today()
    assert summary.expenses == Decimal("0.00")
    assert summary.estimated_result == Decimal("30000.00")


def test_71_each_store_only_sees_its_own_activity(session, store, cashier) -> None:
    other_store = Store.objects.create(name="Boutique Médina")
    other_session = _open_session(other_store, User.objects.create_user(username="c2"))
    coca_here = _product(store, "Coca 50cl", "500", "300")
    coca_there = _product(other_store, "Coca Médina", "500", "350")
    _sell(session, coca_here, 2)
    _sell(other_session, coca_there, 4)
    _expense(session, cashier, "100")

    here = _today(store_id=store.id)
    there = _today(store_id=other_store.id)
    everywhere = _today()

    assert (here.revenue, here.gross_margin, here.expenses) == (
        Decimal("1000.00"), Decimal("400.00"), Decimal("100.00")
    )
    assert (there.revenue, there.gross_margin, there.expenses) == (
        Decimal("2000.00"), Decimal("600.00"), Decimal("0.00")
    )
    assert everywhere.revenue == Decimal("3000.00")
    assert everywhere.estimated_result == Decimal("900.00")


# --- Règles complémentaires ---------------------------------------------------------


def test_past_sale_margin_keeps_its_historical_cost(session, store) -> None:
    rice = _product(store, "Riz 25kg", "5000", "4000")
    _sell(session, rice, 1)

    Stock.objects.filter(product=rice).update(average_unit_cost=Decimal("4500"))

    assert _today().gross_margin == Decimal("1000.00")


def test_sales_outside_the_period_are_ignored(session, store) -> None:
    coca = _product(store, "Coca 50cl", "500", "300")
    sale = _sell(session, coca, 2)
    Sale.objects.filter(pk=sale.pk).update(occurred_at=timezone.now() - timedelta(days=1))

    summary = _today()
    assert summary.revenue == Decimal("0.00")
    assert not summary.has_cost_data
    assert summary.coverage_percent is None


def test_a_return_counts_on_the_day_it_happens(session, store, cashier) -> None:
    rice = _product(store, "Riz 25kg", "5000", "4000")
    sale = _sell(session, rice, 1)
    Sale.objects.filter(pk=sale.pk).update(occurred_at=timezone.now() - timedelta(days=1))

    _return(sale, session, cashier, "1", restock=True)

    summary = _today()
    assert summary.revenue == Decimal("-5000.00")
    assert summary.cost_of_goods_sold == Decimal("-4000.00")
    assert summary.gross_margin == Decimal("-1000.00")
    assert summary.coverage_percent is None


def test_cancelled_sale_counts_nowhere(session, store, cashier) -> None:
    coca = _product(store, "Coca 50cl", "500", "300")
    sale = _sell(session, coca, 2)

    cancel_sale(sale_id=sale.id, cancelled_by=cashier, reason="Erreur de saisie")

    summary = _today()
    assert summary.revenue == Decimal("0.00")
    assert summary.cost_of_goods_sold == Decimal("0.00")


def test_weighed_sale_margin(session, store) -> None:
    banana = Product.objects.create(
        name="Banane", selling_price=Decimal("1200"), sale_unit=Product.SaleUnit.KG
    )
    Stock.objects.create(
        store=store, product=banana, quantity=Decimal("5"), average_unit_cost=Decimal("800")
    )

    _sell(session, banana, "0.300")

    summary = _today()
    assert summary.revenue == Decimal("360.00")
    assert summary.cost_of_goods_sold == Decimal("240.00")
    assert summary.gross_margin == Decimal("120.00")


def test_revenue_matches_the_dashboard_net_sales(session, store, cashier) -> None:
    coca = _product(store, "Coca 50cl", "500", "300")
    soap = _product(store, "Savon", "250", None)
    sale = _sell(session, coca, 4)
    _sell(session, soap, 3)
    _return(sale, session, cashier, "1", restock=False)

    assert _today().revenue == get_manager_dashboard(period="today").net_sales


def test_given_expenses_total_skips_the_expense_query(
    session, store, django_assert_num_queries
) -> None:
    coca = _product(store, "Coca 50cl", "500", "300")
    _sell(session, coca, 2)

    with django_assert_num_queries(2):
        summary = _today(expenses_total=Decimal("100"))

    assert summary.estimated_result == Decimal("300.00")


def test_summary_takes_three_queries(session, store, django_assert_num_queries) -> None:
    coca = _product(store, "Coca 50cl", "500", "300")
    for _ in range(5):
        _sell(session, coca, 1)

    with django_assert_num_queries(3):
        _today()
