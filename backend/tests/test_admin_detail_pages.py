"""Fiches repensées : vente (ticket), dépense, session (Z) et produit."""

from datetime import timedelta
from decimal import Decimal
from uuid import uuid4

import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission
from django.urls import reverse
from django.utils import timezone

from apps.cash.admin_summary import _duration, build_session_z
from apps.cash.models import CashSession
from apps.cash.services import close_cash_session
from apps.catalog.admin_summary import build_product_card
from apps.catalog.models import Product
from apps.customers.services import create_customer
from apps.expenses.models import ExpenseCategory
from apps.expenses.services import cancel_expense, create_expense
from apps.inventory.services import receive_stock
from apps.sales.admin_summary import build_sale_ticket
from apps.sales.models import Payment
from apps.sales.services import complete_sale, create_sale_return
from apps.stores.models import CashRegister, Store


pytestmark = pytest.mark.django_db
User = get_user_model()


@pytest.fixture
def admin_client(client):
    client.force_login(User.objects.create_superuser(username="admin", password="x"))
    return client


@pytest.fixture
def store() -> Store:
    return Store.objects.create(name="Supérette Louga")


@pytest.fixture
def session(store: Store) -> CashSession:
    register = CashRegister.objects.create(store=store, name="Caisse 01")
    return CashSession.objects.create(
        cash_register=register,
        cashier=User.objects.create_user(username="caissier"),
        opening_balance=Decimal("10000"),
    )


@pytest.fixture
def coca(store: Store) -> Product:
    product = Product.objects.create(name="Coca 50cl", selling_price=Decimal("500"))
    receive_stock(store=store, product=product, quantity=20, unit_cost=Decimal("350"))
    return product


def _cash_sale(session, product, quantity, received, unit_price=None):
    price = unit_price or product.selling_price
    total = price * quantity
    return complete_sale(
        cash_session=session,
        items=[{"product_id": product.id, "quantity": Decimal(quantity), "unit_price": unit_price}],
        payments=[
            {"method": Payment.Method.CASH, "amount": total, "received_amount": Decimal(received)}
        ],
    )


# --- Vente : le ticket ------------------------------------------------------------------


def test_sale_ticket_reads_like_the_printed_receipt(session, coca) -> None:
    sale = _cash_sale(session, coca, 3, "2000", unit_price=Decimal("450"))

    ticket = build_sale_ticket(sale)

    assert ticket.reference == sale.reference
    assert ticket.total == "1 350 FCFA"
    line = ticket.lines[0]
    assert (line.name, line.quantity, line.unit_price, line.total) == (
        "Coca 50cl", "3", "450 FCFA", "1 350 FCFA"
    )
    assert line.catalog_price == "500 FCFA"  # prix modifié à la caisse
    payment = ticket.payments[0]
    assert (payment.method, payment.amount) == ("Espèces", "1 350 FCFA")
    assert payment.detail == "Reçu 2 000 FCFA · rendu 650 FCFA"
    assert ticket.returns == [] and ticket.net_total is None


def test_sale_ticket_shows_the_book_and_the_returns(session, store, coca) -> None:
    customer = create_customer(store=store, name="Moussa Fall", phone=None)
    sale = complete_sale(
        cash_session=session,
        items=[{"product_id": coca.id, "quantity": Decimal("2"), "unit_price": None}],
        payments=[],
        customer_id=customer.id,
        credit_amount=Decimal("1000"),
    )
    create_sale_return(
        original_sale=sale,
        cash_session=session,
        created_by=session.cashier,
        idempotency_key=uuid4(),
        items=[{"sale_item_id": sale.items.get().id, "quantity": Decimal("1"), "restock": True}],
    )

    ticket = build_sale_ticket(sale)

    assert ticket.credit_amount == "1 000 FCFA"
    assert ticket.customer_name == "Moussa Fall"
    assert ticket.lines[0].returned == "1"
    assert [r.amount for r in ticket.returns] == ["500 FCFA"]
    assert ticket.net_total == "500 FCFA"


def test_sale_page_opens_on_its_ticket(admin_client, session, coca) -> None:
    sale = _cash_sale(session, coca, 2, "1000")

    content = admin_client.get(reverse("admin:sales_sale_change", args=[sale.pk])).content.decode()

    assert f"Ticket {sale.reference}" in content
    assert "Articles" in content and "Règlement" in content
    assert "Voir / imprimer le ticket" in content


# --- Dépense ------------------------------------------------------------------------------


def _expense(session, amount="2000"):
    return create_expense(
        cash_session=session,
        created_by=session.cashier,
        category=ExpenseCategory.objects.get(name="Autre"),
        amount=Decimal(amount),
        payment_method=Payment.Method.WAVE,
        description="Sacs",
        idempotency_key=uuid4(),
    )


def test_cancelled_expense_says_who_when_and_why(admin_client, session) -> None:
    expense = _expense(session)
    cancel_expense(expense=expense, cancelled_by=session.cashier, reason="Saisie en double")

    content = admin_client.get(
        reverse("admin:expenses_expense_change", args=[expense.pk])
    ).content.decode()

    assert "Annulée le" in content
    assert "Saisie en double" in content
    assert "Elle ne compte plus" in content


def test_expense_of_a_closed_session_explains_why_it_cannot_be_cancelled(
    admin_client, session
) -> None:
    expense = _expense(session)
    url = reverse("admin:expenses_expense_change", args=[expense.pk])
    assert "Annulation impossible" not in admin_client.get(url).content.decode()

    close_cash_session(cash_session=session, counted_cash=Decimal("10000"))

    assert "Annulation impossible" in admin_client.get(url).content.decode()


# --- Session : le Z -------------------------------------------------------------------------


def test_session_z_follows_the_drawer_formula(session, coca) -> None:
    sale = _cash_sale(session, coca, 4, "2000")  # +2 000 espèces
    create_sale_return(
        original_sale=sale,
        cash_session=session,
        created_by=session.cashier,
        payment_method=Payment.Method.CASH,
        idempotency_key=uuid4(),
        items=[{"sale_item_id": sale.items.get().id, "quantity": Decimal("1"), "restock": True}],
    )  # −500 espèces
    create_expense(
        cash_session=session,
        created_by=session.cashier,
        category=ExpenseCategory.objects.get(name="Autre"),
        amount=Decimal("300"),
        payment_method=Payment.Method.CASH,
        description="Sacs",
        idempotency_key=uuid4(),
    )  # −300 espèces
    close_cash_session(cash_session=session, counted_cash=Decimal("11000"))
    session.refresh_from_db()

    z = build_session_z(session)

    amounts = {row.label: row.amount for row in z.drawer}
    assert amounts["Fond de caisse"] == "10 000 FCFA"
    assert amounts["Ventes en espèces"] == "2 000 FCFA"
    assert amounts["Retours remboursés en espèces"] == "500 FCFA"
    assert amounts["Dépenses en espèces"] == "300 FCFA"
    # 10 000 + 2 000 − 500 − 300 = 11 200 attendus ; 11 000 comptés.
    assert z.expected == "11 200 FCFA"
    assert z.counted == "11 000 FCFA"
    assert z.difference == ("danger", "Manque — 200 FCFA")
    assert z.report_url is not None


def test_session_page_opens_on_its_z(admin_client, session) -> None:
    content = admin_client.get(
        reverse("admin:cash_cashsession_change", args=[session.pk])
    ).content.decode()

    assert "Tiroir espèces" in content
    assert "Attendu dans le tiroir" in content
    assert "Rapport Z disponible une fois la session fermée." in content


@pytest.mark.parametrize(
    "minutes, expected", [(45, "45 min"), (125, "2 h 05"), (60 * 514 + 29, "21 j 10 h")]
)
def test_session_duration_stays_readable(minutes: int, expected: str) -> None:
    start = timezone.now()

    assert _duration(start, start + timedelta(minutes=minutes)) == expected


# --- Produit ------------------------------------------------------------------------------


def test_product_card_shows_stock_value_and_recent_sales(session, store, coca) -> None:
    _cash_sale(session, coca, 3, "1500")

    card = build_product_card(coca, can_view_costs=True)

    stock = card.stocks[0]
    assert (stock.store, stock.quantity, stock.status) == ("Supérette Louga", "17", ("success", "OK"))
    assert stock.average_cost == "350 FCFA"
    assert stock.cost_value == "5 950 FCFA"
    assert (card.sold_quantity, card.sold_revenue) == ("3", "1 500 FCFA")
    assert [m.quantity for m in card.movements] == ["-3", "+20"]


def test_product_card_hides_costs_without_valuation_access(coca) -> None:
    card = build_product_card(coca, can_view_costs=False)

    assert card.stocks[0].average_cost is None
    assert card.stocks[0].cost_value is None
    assert card.last_purchase_price is None


def test_product_page_hides_costs_from_staff_without_valuation_access(client, coca) -> None:
    staff = User.objects.create_user(username="staff", password="x", is_staff=True)
    staff.user_permissions.add(
        *Permission.objects.filter(codename__in=["view_product", "change_product"])
    )
    client.force_login(staff)

    content = client.get(reverse("admin:catalog_product_change", args=[coca.pk])).content.decode()

    assert "Ajouter du stock" in content
    assert "Coût moyen" not in content
    assert "350 FCFA" not in content


def test_new_product_form_has_no_summary(admin_client) -> None:
    content = admin_client.get(reverse("admin:catalog_product_add")).content.decode()

    assert "Derniers mouvements" not in content
