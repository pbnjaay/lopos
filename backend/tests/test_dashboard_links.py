from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone

from apps.cash.models import CashSession
from apps.catalog.models import Product
from apps.inventory.models import Stock
from apps.sales.models import Payment, Sale
from apps.stores.models import CashRegister, Store


pytestmark = pytest.mark.django_db
User = get_user_model()


@pytest.fixture
def manager_client(client):
    user = User.objects.create_superuser(username="gerant", password="pw", email="g@example.com")
    client.force_login(user)
    return client


@pytest.fixture
def store() -> Store:
    return Store.objects.create(name="Supérette Test")


@pytest.fixture
def cashier():
    return User.objects.create_user(username="cashier")


@pytest.fixture
def cash_session(store: Store, cashier) -> CashSession:
    register = CashRegister.objects.create(store=store, name="Caisse 01")
    return CashSession.objects.create(
        cash_register=register, cashier=cashier, opening_balance=Decimal("0")
    )


def test_sales_period_filter_only_shows_today(manager_client, cash_session, cashier) -> None:
    yesterday = timezone.localtime() - timezone.timedelta(days=1)
    Sale.objects.create(
        cash_session=cash_session, cashier=cashier, subtotal=Decimal("1000"),
        discount=Decimal("0"), total=Decimal("1000"), status=Sale.Status.COMPLETED,
        occurred_at=yesterday,
    )
    Sale.objects.create(
        cash_session=cash_session, cashier=cashier, subtotal=Decimal("2000"),
        discount=Decimal("0"), total=Decimal("2000"), status=Sale.Status.COMPLETED,
    )

    response = manager_client.get("/admin/sales/sale/?period=today")

    assert response.status_code == 200
    assert response.context["cl"].queryset.count() == 1


def test_open_sessions_link_filters_by_status(manager_client, cash_session) -> None:
    response = manager_client.get("/admin/cash/cashsession/?status__exact=OPEN")

    assert response.status_code == 200
    assert list(response.context["cl"].queryset) == [cash_session]


def test_stock_status_filter_separates_out_of_stock_and_low_stock(manager_client, store) -> None:
    out_of_stock = Product.objects.create(name="Rupture", selling_price=Decimal("100"))
    low_stock = Product.objects.create(name="Faible", selling_price=Decimal("100"))
    healthy = Product.objects.create(name="OK", selling_price=Decimal("100"))
    Stock.objects.create(store=store, product=out_of_stock, quantity=0)
    Stock.objects.create(store=store, product=low_stock, quantity=2)
    Stock.objects.create(store=store, product=healthy, quantity=50)

    out_response = manager_client.get("/admin/inventory/stock/?stock_status=out")
    low_response = manager_client.get("/admin/inventory/stock/?stock_status=low")

    assert [s.product for s in out_response.context["cl"].queryset] == [out_of_stock]
    assert [s.product for s in low_response.context["cl"].queryset] == [low_stock]


def test_recent_sale_row_links_to_sale_detail(manager_client, cash_session, cashier) -> None:
    sale = Sale.objects.create(
        cash_session=cash_session, cashier=cashier, subtotal=Decimal("500"),
        discount=Decimal("0"), total=Decimal("500"), status=Sale.Status.COMPLETED,
    )

    response = manager_client.get(f"/admin/sales/sale/{sale.pk}/change/")

    assert response.status_code == 200
