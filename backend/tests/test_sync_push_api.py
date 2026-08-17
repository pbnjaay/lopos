from decimal import Decimal
from uuid import uuid4

import pytest
from django.contrib.auth import get_user_model
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from apps.cash.models import CashSession
from apps.catalog.models import Product
from apps.inventory.models import InventoryMovement, Stock
from apps.sales.models import Payment, Sale
from apps.stores.models import CashRegister, Store
from apps.sync.models import ProcessedSyncEvent

pytestmark = pytest.mark.django_db
User = get_user_model()


@pytest.fixture
def cashier():
    return User.objects.create_user(username="cashier", password="secret")


@pytest.fixture
def api_client(cashier) -> APIClient:
    client = APIClient()
    client.force_authenticate(cashier)
    return client


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


@pytest.fixture
def product(store: Store) -> Product:
    product = Product.objects.create(name="Coca 50cl", selling_price=Decimal("500.00"))
    Stock.objects.create(store=store, product=product, quantity=20)
    return product


def _sale_event(*, cash_session, product, event_id=None, entity_id=None, quantity=2):
    return {
        "event_id": str(event_id or uuid4()),
        "type": "SALE_COMPLETED",
        "entity_id": str(entity_id or uuid4()),
        "occurred_at": timezone.now().isoformat(),
        "payload": {
            "cash_session_id": str(cash_session.id),
            "items": [
                {
                    "product_id": str(product.id),
                    "product_name": product.name,
                    "unit_price": "500.00",
                    "quantity": quantity,
                }
            ],
            "payment": {"method": "CASH", "received_amount": "2000.00"},
        },
    }


def test_push_batch_synced_once(
    api_client: APIClient, cash_session: CashSession, product: Product
) -> None:
    event = _sale_event(cash_session=cash_session, product=product)

    response = api_client.post(
        reverse("sync-push"),
        {"terminal_id": str(uuid4()), "events": [event]},
        format="json",
    )

    assert response.status_code == status.HTTP_200_OK
    body = response.json()
    assert body["results"] == [
        {
            "event_id": event["event_id"],
            "status": "SYNCED",
            "entity_id": event["entity_id"],
        }
    ]
    assert Sale.objects.count() == 1
    assert Payment.objects.count() == 1
    assert InventoryMovement.objects.filter(
        movement_type=InventoryMovement.Type.SALE
    ).count() == 1


def test_resending_same_batch_is_a_pure_noop(
    api_client: APIClient, cash_session: CashSession, product: Product
) -> None:
    """Simule un timeout après commit : le client renvoie tout le batch."""
    event = _sale_event(cash_session=cash_session, product=product)

    first = api_client.post(
        reverse("sync-push"),
        {"terminal_id": str(uuid4()), "events": [event]},
        format="json",
    )
    second = api_client.post(
        reverse("sync-push"),
        {"terminal_id": str(uuid4()), "events": [event]},
        format="json",
    )

    assert first.json()["results"][0]["status"] == "SYNCED"
    assert second.json()["results"][0]["status"] == "ALREADY_PROCESSED"
    assert second.json()["results"][0]["entity_id"] == event["entity_id"]
    assert Sale.objects.count() == 1
    assert Payment.objects.count() == 1
    assert InventoryMovement.objects.filter(
        movement_type=InventoryMovement.Type.SALE
    ).count() == 1
    assert ProcessedSyncEvent.objects.count() == 1


def test_push_batch_returns_mixed_results_without_all_or_nothing(
    api_client: APIClient, cash_session: CashSession, product: Product
) -> None:
    good_event = _sale_event(cash_session=cash_session, product=product)
    already_processed_event = dict(good_event)  # même event_id, renvoyé
    ghost_product_event = _sale_event(cash_session=cash_session, product=product)
    ghost_product_event["payload"]["items"][0]["product_id"] = str(uuid4())

    api_client.post(
        reverse("sync-push"),
        {"terminal_id": str(uuid4()), "events": [good_event]},
        format="json",
    )

    response = api_client.post(
        reverse("sync-push"),
        {
            "terminal_id": str(uuid4()),
            "events": [already_processed_event, ghost_product_event],
        },
        format="json",
    )

    assert response.status_code == status.HTTP_200_OK
    results = {r["event_id"]: r for r in response.json()["results"]}
    assert results[already_processed_event["event_id"]]["status"] == "ALREADY_PROCESSED"
    assert results[ghost_product_event["event_id"]]["status"] == "REJECTED"
    assert results[ghost_product_event["event_id"]]["code"] == "PRODUCT_NOT_FOUND"
    assert Sale.objects.count() == 1


def test_push_rejects_terminal_injecting_into_another_cashiers_session(
    api_client: APIClient, cash_session: CashSession, product: Product
) -> None:
    User.objects.create_user(username="other-cashier")
    other_client = APIClient()
    other_client.force_authenticate(User.objects.get(username="other-cashier"))

    event = _sale_event(cash_session=cash_session, product=product)
    response = other_client.post(
        reverse("sync-push"),
        {"terminal_id": str(uuid4()), "events": [event]},
        format="json",
    )

    assert response.status_code == status.HTTP_200_OK
    result = response.json()["results"][0]
    assert result["status"] == "REJECTED"
    assert result["code"] == "CASH_SESSION_NOT_OWNED"
    assert Sale.objects.count() == 0


def test_push_batch_size_is_capped(
    api_client: APIClient, cash_session: CashSession, product: Product
) -> None:
    events = [
        _sale_event(cash_session=cash_session, product=product, quantity=1)
        for _ in range(51)
    ]

    response = api_client.post(
        reverse("sync-push"),
        {"terminal_id": str(uuid4()), "events": events},
        format="json",
    )

    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert Sale.objects.count() == 0


def test_push_requires_authentication(
    cash_session: CashSession, product: Product
) -> None:
    anonymous_client = APIClient()
    event = _sale_event(cash_session=cash_session, product=product)

    response = anonymous_client.post(
        reverse("sync-push"),
        {"terminal_id": str(uuid4()), "events": [event]},
        format="json",
    )

    assert response.status_code == status.HTTP_403_FORBIDDEN
