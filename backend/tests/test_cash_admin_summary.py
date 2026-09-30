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

    assert model_admin.difference_label(cash_session) == ("shortage", "Manque — 1 500 FCFA")


def test_difference_label_flags_surplus(cash_session: CashSession) -> None:
    cash_session.difference = Decimal("500.00")
    model_admin = CashSessionAdmin(CashSession, admin.site)

    assert model_admin.difference_label(cash_session) == ("surplus", "Surplus — 500 FCFA")


def test_difference_label_shows_ok_when_balanced(cash_session: CashSession) -> None:
    cash_session.difference = Decimal("0.00")
    model_admin = CashSessionAdmin(CashSession, admin.site)

    assert model_admin.difference_label(cash_session) == ("ok", "OK — 0 FCFA")


def test_z_report_link_waits_for_the_session_to_close(cash_session: CashSession) -> None:
    from apps.cash.admin_summary import build_session_z

    assert build_session_z(cash_session).report_url is None


def test_z_report_link_once_closed(cash_session: CashSession, settings) -> None:
    from apps.cash.admin_summary import build_session_z

    settings.FRONTEND_URL = "https://caisse.example.com"
    cash_session.status = CashSession.Status.CLOSED
    cash_session.closed_at = timezone.now()
    cash_session.save()

    z = build_session_z(cash_session)

    assert z.report_url == f"https://caisse.example.com/cash-sessions/{cash_session.pk}/report"


def test_z_of_a_new_session_follows_the_expected_cash_formula(
    cash_session: CashSession,
) -> None:
    from apps.cash.admin_summary import build_session_z

    z = build_session_z(cash_session)

    assert z.sales_count == 0
    assert [row.label for row in z.drawer] == [
        "Fond de caisse",
        "Ventes en espèces",
        "Retours remboursés en espèces",
        "Remboursements cahier en espèces",
        "Dépenses en espèces",
    ]
    assert z.expected == "15 000 FCFA"
    assert z.difference is None
