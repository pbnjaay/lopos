"""Prix catalogue d'une vente hors ligne (H3, option B).

Le prix catalogue envoyé par le poste est gardé (le catalogue a pu changer
pendant la coupure), mais il n'est jamais cru sur parole : s'il diffère du
prix serveur, celui-ci est noté sur la ligne et la vente remonte pour revue.
"""

from decimal import Decimal
from uuid import uuid4

import pytest
from django.contrib.auth import get_user_model
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from apps.cash.models import CashSession
from apps.catalog.models import Product
from apps.dashboard.services import get_manager_dashboard
from apps.inventory.models import Stock
from apps.sales.models import Sale
from apps.stores.models import CashRegister, Store, StoreAssignment
from apps.sync.models import ProcessedSyncEvent

pytestmark = pytest.mark.django_db
User = get_user_model()

ALERT_TEXT = "prix catalogue à vérifier"


@pytest.fixture
def cashier():
    return User.objects.create_user(username="cashier", password="secret")


@pytest.fixture
def store() -> Store:
    return Store.objects.create(name="Supérette Test")


@pytest.fixture
def cash_session(store: Store, cashier) -> CashSession:
    register = CashRegister.objects.create(store=store, name="Caisse 01")
    return CashSession.objects.create(
        cash_register=register, cashier=cashier, opening_balance=Decimal("50000.00")
    )


@pytest.fixture
def product(store: Store) -> Product:
    product = Product.objects.create(name="Huile 5L", selling_price=Decimal("25000.00"))
    Stock.objects.create(store=store, product=product, quantity=10)
    return product


def _push(cashier, cash_session, product, *, unit_price: str, catalog_unit_price: str | None):
    item = {
        "product_id": str(product.id),
        "product_name": product.name,
        "unit_price": unit_price,
        "quantity": 1,
    }
    if catalog_unit_price is not None:
        item["catalog_unit_price"] = catalog_unit_price
    event = {
        "event_id": str(uuid4()),
        "type": "SALE_COMPLETED",
        "entity_id": str(uuid4()),
        "occurred_at": timezone.now().isoformat(),
        "payload": {
            "cash_session_id": str(cash_session.id),
            "items": [item],
            "payments": [{"method": "WAVE", "amount": unit_price}],
        },
    }
    client = APIClient()
    client.force_authenticate(cashier)
    response = client.post(
        reverse("sync-push"), {"terminal_id": str(uuid4()), "events": [event]}, format="json"
    )
    result = response.json()["results"][0]
    assert result["status"] == "SYNCED", result
    sale = Sale.objects.get(pk=result["entity_id"])
    return sale.items.get(), ProcessedSyncEvent.objects.get(pk=event["event_id"])


def test_matching_catalog_price_is_not_flagged(cashier, cash_session, product) -> None:
    item, event = _push(
        cashier, cash_session, product, unit_price="25000.00", catalog_unit_price="25000.00"
    )

    assert item.catalog_unit_price == Decimal("25000.00")
    assert item.server_catalog_unit_price is None
    assert event.catalog_price_discrepancy is False


def test_missing_catalog_price_falls_back_to_the_server_without_flag(
    cashier, cash_session, product
) -> None:
    item, event = _push(
        cashier, cash_session, product, unit_price="20000.00", catalog_unit_price=None
    )

    assert item.catalog_unit_price == Decimal("25000.00")
    assert item.server_catalog_unit_price is None
    assert event.catalog_price_discrepancy is False


def test_a_forged_catalog_price_hiding_a_discount_is_kept_but_flagged(
    cashier, cash_session, product
) -> None:
    # Le poste prétend que le prix catalogue était celui de la vente :
    # la remise de 24 000 FCFA disparaîtrait sans la trace du serveur.
    item, event = _push(
        cashier, cash_session, product, unit_price="1000.00", catalog_unit_price="1000.00"
    )

    assert item.catalog_unit_price == Decimal("1000.00")
    assert item.unit_price == Decimal("1000.00")
    assert item.server_catalog_unit_price == Decimal("25000.00")
    assert event.catalog_price_discrepancy is True


def test_a_price_change_during_the_outage_keeps_the_historical_price_and_is_flagged(
    cashier, cash_session, product
) -> None:
    item, event = _push(
        cashier, cash_session, product, unit_price="24000.00", catalog_unit_price="24000.00"
    )

    # Prix affiché au moment de la vente conservé ; écart avec le serveur noté.
    assert item.catalog_unit_price == Decimal("24000.00")
    assert item.server_catalog_unit_price == Decimal("25000.00")
    assert event.catalog_price_discrepancy is True


def test_online_sales_never_carry_a_server_catalog_price(
    cashier, store, cash_session, product
) -> None:
    StoreAssignment.objects.create(user=cashier, store=store)
    client = APIClient()
    client.force_authenticate(cashier)
    response = client.post(
        reverse("sale-complete"),
        {
            "cash_session_id": str(cash_session.id),
            "items": [{"product_id": str(product.id), "quantity": "1"}],
            "payments": [{"method": "WAVE", "amount": "25000.00"}],
        },
        format="json",
    )

    assert response.status_code == 201, response.json()
    assert Sale.objects.get(pk=response.json()["id"]).items.get().server_catalog_unit_price is None


def test_dashboard_raises_an_alert_for_flagged_offline_sales(
    cashier, cash_session, product
) -> None:
    assert not any(ALERT_TEXT in alert.text for alert in get_manager_dashboard().alerts)

    _push(cashier, cash_session, product, unit_price="1000.00", catalog_unit_price="1000.00")

    alerts = [a for a in get_manager_dashboard().alerts if ALERT_TEXT in a.text]
    assert len(alerts) == 1
    assert "catalog_price_discrepancy__exact=1" in alerts[0].url
