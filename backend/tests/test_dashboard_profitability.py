from datetime import date, timedelta
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.management import call_command
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.urls import reverse
from django.utils import timezone

from apps.cash.models import CashSession
from apps.catalog.models import Product
from apps.dashboard.period import CUSTOM, parse_custom_range, resolve_dashboard_period
from apps.dashboard.services import get_manager_dashboard
from apps.inventory.models import Stock
from apps.sales.models import Payment, Sale
from apps.sales.services import complete_sale
from apps.stores.models import CashRegister, Store


pytestmark = pytest.mark.django_db
User = get_user_model()


@pytest.fixture
def store() -> Store:
    return Store.objects.create(name="Supérette Louga")


@pytest.fixture
def session(store: Store) -> CashSession:
    cashier = User.objects.create_user(username="cashier")
    register = CashRegister.objects.create(store=store, name="Caisse 01")
    return CashSession.objects.create(
        cash_register=register, cashier=cashier, opening_balance=Decimal("10000")
    )


@pytest.fixture
def manager_client(client):
    call_command("create_default_groups", stdout=None)
    user = User.objects.create_user(username="gerant", password="pass1234", is_staff=True)
    user.groups.add(Group.objects.get(name="Gérant"))
    client.force_login(user)
    return client


def _sell(session: CashSession, store: Store, name: str, price, cost, quantity=1) -> Sale:
    product = Product.objects.create(name=name, selling_price=Decimal(price))
    Stock.objects.create(
        store=store,
        product=product,
        quantity=100,
        average_unit_cost=None if cost is None else Decimal(cost),
    )
    return complete_sale(
        cash_session=session,
        items=[{"product_id": product.id, "quantity": Decimal(quantity), "unit_price": None}],
        payments=[{"method": Payment.Method.WAVE, "amount": Decimal(price) * quantity}],
    )


# --- Période libre ------------------------------------------------------------


def test_custom_range_accepts_two_ordered_dates() -> None:
    assert parse_custom_range("2026-09-01", "2026-09-15") == (date(2026, 9, 1), date(2026, 9, 15))
    assert parse_custom_range("2026-09-01", "2026-09-01") == (date(2026, 9, 1), date(2026, 9, 1))


@pytest.mark.parametrize(
    "raw_from, raw_to",
    [
        ("2026-09-15", "2026-09-01"),  # à l'envers
        ("2025-01-01", "2026-09-01"),  # plus d'un an
        ("n'importe quoi", "2026-09-01"),
        ("2026-09-01", None),
        (None, None),
    ],
)
def test_custom_range_rejects_invalid_input(raw_from, raw_to) -> None:
    assert parse_custom_range(raw_from, raw_to) is None


def test_valid_dates_win_over_the_preset_and_cover_whole_local_days() -> None:
    period = resolve_dashboard_period("7d", "2026-09-01", "2026-09-02")

    assert period.key == CUSTOM
    assert timezone.localtime(period.start).isoformat().startswith("2026-09-01T00:00:00")
    assert timezone.localtime(period.end).isoformat().startswith("2026-09-03T00:00:00")
    assert period.label == "du 01/09/2026 au 02/09/2026"


def test_invalid_dates_fall_back_to_the_preset() -> None:
    period = resolve_dashboard_period("yesterday", "2026-09-15", "2026-09-01")

    assert period.key == "yesterday"
    assert period.label == "Hier"


def test_custom_range_includes_older_sales(session: CashSession, store: Store) -> None:
    sale = _sell(session, store, "Coca 50cl", "500", "300")
    three_days_ago = timezone.localtime() - timedelta(days=3)
    Sale.objects.filter(pk=sale.pk).update(occurred_at=three_days_ago)
    day = three_days_ago.date().isoformat()

    dashboard = get_manager_dashboard(date_from=day, date_to=day, include_profitability=True)

    assert dashboard.period == CUSTOM
    assert dashboard.net_sales == Decimal("500.00")
    assert dashboard.profitability.gross_margin == Decimal("200.00")
    assert f"occurred_at__date__gte={day}" in dashboard.sales_url
    assert get_manager_dashboard(period="today").net_sales == Decimal("0.00")


def test_custom_sales_link_opens_the_filtered_sales_list(
    manager_client, session: CashSession, store: Store
) -> None:
    sale = _sell(session, store, "Coca 50cl", "500", "300")
    Sale.objects.filter(pk=sale.pk).update(occurred_at=timezone.now() - timedelta(days=3))
    _sell(session, store, "Fanta", "400", "250")
    day = (timezone.localtime() - timedelta(days=3)).date().isoformat()

    url = get_manager_dashboard(date_from=day, date_to=day).sales_url
    response = manager_client.get(url)

    assert response.status_code == 200
    assert [row.pk for row in response.context["cl"].result_list] == [sale.pk]


# --- Service -------------------------------------------------------------------


def test_profitability_is_only_computed_on_request(session: CashSession, store: Store) -> None:
    _sell(session, store, "Coca 50cl", "500", "300")

    assert get_manager_dashboard().profitability is None
    assert get_manager_dashboard(include_profitability=True).profitability.gross_margin == Decimal(
        "200.00"
    )


def test_profitability_costs_two_extra_queries(session: CashSession, store: Store) -> None:
    _sell(session, store, "Coca 50cl", "500", "300")

    with CaptureQueriesContext(connection) as without:
        get_manager_dashboard()
    with CaptureQueriesContext(connection) as with_profitability:
        get_manager_dashboard(include_profitability=True)

    # Ventes et retours ; le total des dépenses est réutilisé.
    assert len(with_profitability) - len(without) == 2


def test_scope_is_always_named(session: CashSession, store: Store) -> None:
    assert get_manager_dashboard().scope_label == "Tous les magasins"
    assert get_manager_dashboard(store_id=str(store.pk)).scope_label == "Supérette Louga"


# --- Carte du tableau de bord -----------------------------------------------------


def test_manager_sees_the_profitability_card(
    manager_client, session: CashSession, store: Store
) -> None:
    _sell(session, store, "Riz 25kg", "5000", "4000", quantity=2)

    response = manager_client.get(reverse("admin:index"))

    content = response.content.decode()
    assert "Rentabilité" in content
    # Libellé de période : une variable, donc échappée.
    assert "Aujourd&#x27;hui · Tous les magasins" in content
    assert "Coût des marchandises vendues" in content
    assert "8 000 FCFA" in content
    assert "Résultat estimé" in content
    assert "2 000 FCFA" in content
    assert "Ce n'est pas un résultat comptable" in content
    assert "Bénéfice" not in content
    assert "Résultat incomplet" not in content


def test_staff_without_permission_never_sees_costs_or_margins(
    client, session: CashSession, store: Store
) -> None:
    staff = User.objects.create_user(username="staff", password="pass1234", is_staff=True)
    client.force_login(staff)
    _sell(session, store, "Riz 25kg", "5000", "4000")

    response = client.get(reverse("admin:index"))

    content = response.content.decode()
    assert response.status_code == 200
    assert "Rentabilité" not in content
    assert "Marge brute" not in content
    assert response.context["dashboard"].profitability is None


def test_card_warns_when_part_of_the_revenue_has_no_cost(
    manager_client, session: CashSession, store: Store
) -> None:
    _sell(session, store, "Coca 50cl", "500", "300", quantity=4)
    _sell(session, store, "Savon", "500", None)

    response = manager_client.get(reverse("admin:index"))

    content = response.content.decode()
    assert "dont sans coût d" in content
    assert "Résultat incomplet : 20 % du chiffre d" in content
    assert "valuation=uncosted" in content


def test_card_explains_when_no_cost_is_known(
    manager_client, session: CashSession, store: Store
) -> None:
    _sell(session, store, "Savon", "500", None)

    response = manager_client.get(reverse("admin:index"))

    content = response.content.decode()
    assert "Coût d'achat non disponible" in content
    assert "Résultat estimé" not in content


def test_card_follows_the_store_and_the_custom_dates(
    manager_client, session: CashSession, store: Store
) -> None:
    _sell(session, store, "Riz 25kg", "5000", "4000")
    today = timezone.localdate().isoformat()

    response = manager_client.get(
        reverse("admin:index"), {"store": str(store.pk), "from": today, "to": today}
    )

    dashboard = response.context["dashboard"]
    assert dashboard.scope_label == "Supérette Louga"
    assert dashboard.period == CUSTOM
    assert dashboard.profitability.gross_margin == Decimal("1000.00")
    content = response.content.decode()
    assert f'value="{today}"' in content
    assert "Période choisie" in content
