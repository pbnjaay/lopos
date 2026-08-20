from decimal import Decimal

import pytest
from django.contrib import admin

from apps.cash.models import CashSession
from apps.sales.admin import SaleAdmin
from apps.sales.models import Payment, Sale
from apps.stores.models import CashRegister, Store
from django.contrib.auth import get_user_model


pytestmark = pytest.mark.django_db
User = get_user_model()


@pytest.fixture
def cashier():
    return User.objects.create_user(username="cashier")


@pytest.fixture
def cash_session(cashier) -> CashSession:
    store = Store.objects.create(name="Supérette Test")
    register = CashRegister.objects.create(store=store, name="Caisse 01")
    return CashSession.objects.create(
        cash_register=register,
        cashier=cashier,
        opening_balance=Decimal("15000.00"),
    )


@pytest.fixture
def sale(cash_session: CashSession, cashier) -> Sale:
    return Sale.objects.create(
        cash_session=cash_session,
        cashier=cashier,
        subtotal=Decimal("1000.00"),
        discount=Decimal("0.00"),
        total=Decimal("1000.00"),
        status=Sale.Status.COMPLETED,
    )


def test_total_display_uses_fcfa_format(sale: Sale) -> None:
    model_admin = SaleAdmin(Sale, admin.site)

    assert model_admin.total_display(sale) == "1 000 FCFA"


def test_payment_method_shows_dash_without_payment(sale: Sale) -> None:
    model_admin = SaleAdmin(Sale, admin.site)

    assert model_admin.payment_method(sale) == "—"


def test_payment_method_shows_french_label(sale: Sale) -> None:
    Payment.objects.create(
        sale=sale,
        method=Payment.Method.WAVE,
        amount=Decimal("1000.00"),
    )
    model_admin = SaleAdmin(Sale, admin.site)
    sale.refresh_from_db()

    assert model_admin.payment_method(sale) == "Wave"


def test_ticket_link_points_to_frontend_receipt_route(sale: Sale, settings) -> None:
    settings.FRONTEND_URL = "https://caisse.example.com"
    model_admin = SaleAdmin(Sale, admin.site)

    link = model_admin.ticket_link(sale)

    assert f"https://caisse.example.com/sales/{sale.pk}/receipt" in link
