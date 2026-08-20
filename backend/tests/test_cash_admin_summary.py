from decimal import Decimal

import pytest
from django.contrib import admin
from django.contrib.auth import get_user_model
from django.utils import timezone

from apps.cash.admin import CashSessionAdmin
from apps.cash.models import CashSession
from apps.stores.models import CashRegister, Store


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


def test_difference_label_shows_dash_while_open(cash_session: CashSession) -> None:
    model_admin = CashSessionAdmin(CashSession, admin.site)

    assert model_admin.difference_label(cash_session) == "—"


def test_difference_label_flags_shortage(cash_session: CashSession) -> None:
    cash_session.difference = Decimal("-1500.00")
    model_admin = CashSessionAdmin(CashSession, admin.site)

    assert model_admin.difference_label(cash_session) == "Manque — -1 500 FCFA"


def test_difference_label_flags_surplus(cash_session: CashSession) -> None:
    cash_session.difference = Decimal("500.00")
    model_admin = CashSessionAdmin(CashSession, admin.site)

    assert model_admin.difference_label(cash_session) == "Surplus — 500 FCFA"


def test_difference_label_shows_ok_when_balanced(cash_session: CashSession) -> None:
    cash_session.difference = Decimal("0.00")
    model_admin = CashSessionAdmin(CashSession, admin.site)

    assert model_admin.difference_label(cash_session) == "OK — 0 FCFA"


def test_report_link_unavailable_while_open(cash_session: CashSession) -> None:
    model_admin = CashSessionAdmin(CashSession, admin.site)

    assert "Disponible une fois" in model_admin.report_link(cash_session)


def test_report_link_available_once_closed(cash_session: CashSession, settings) -> None:
    settings.FRONTEND_URL = "https://caisse.example.com"
    cash_session.status = CashSession.Status.CLOSED
    cash_session.closed_at = timezone.now()
    cash_session.save()
    model_admin = CashSessionAdmin(CashSession, admin.site)

    link = model_admin.report_link(cash_session)

    assert f"https://caisse.example.com/cash-sessions/{cash_session.pk}/report" in link


def test_sales_summary_reports_zero_sales_for_new_session(
    cash_session: CashSession,
) -> None:
    model_admin = CashSessionAdmin(CashSession, admin.site)

    summary_html = model_admin.sales_summary(cash_session)

    assert "0" in summary_html
    assert "0 FCFA" in summary_html
