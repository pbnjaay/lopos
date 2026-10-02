from decimal import Decimal
from uuid import uuid4

import pytest
from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient

from apps.cash.models import CashSession
from apps.customers.models import Customer
from apps.customers.services import (
    create_customer,
    record_adjustment,
    record_customer_payment,
    record_opening_balance,
)
from apps.stores.models import CashRegister, Store, StoreAssignment


pytestmark = pytest.mark.django_db
User = get_user_model()


@pytest.fixture
def store() -> Store:
    return Store.objects.create(name="Supérette Test")


@pytest.fixture
def cashier(store: Store):
    user = User.objects.create_user(username="cashier")
    StoreAssignment.objects.create(user=user, store=store)
    return user


@pytest.fixture
def api_client(cashier) -> APIClient:
    client = APIClient()
    client.force_authenticate(cashier)
    return client


def _book(api_client, store):
    return api_client.get(reverse("customer-list"), {"store_id": str(store.pk)})


def test_book_lists_store_customers_with_balance_and_last_activity(api_client, store) -> None:
    moussa = create_customer(store=store, name="Moussa Fall", phone="771234567")
    opening = record_opening_balance(customer=moussa, amount=Decimal("18500"))
    create_customer(store=store, name="Awa Diop", phone="760001122")
    create_customer(store=Store.objects.create(name="Autre"), name="Intrus", phone="780000000")

    response = _book(api_client, store)

    assert response.status_code == status.HTTP_200_OK
    assert [c["name"] for c in response.data] == ["Awa Diop", "Moussa Fall"]
    awa, moussa_data = response.data
    assert awa["balance"] == "0.00"
    assert awa["last_activity_at"] is None
    assert moussa_data["balance"] == "18500.00"
    assert moussa_data["phone"] == "+221771234567"
    assert moussa_data["store_id"] == str(store.pk)
    assert moussa_data["last_activity_at"] is not None
    assert moussa_data["last_activity_at"].startswith(opening.occurred_at.date().isoformat())


def test_book_includes_deactivated_customers(api_client, store) -> None:
    customer = create_customer(store=store, name="Moussa Fall", phone="771234567")
    Customer.objects.filter(pk=customer.pk).update(is_active=False)

    response = _book(api_client, store)

    assert response.data[0]["is_active"] is False


def test_book_requires_store_access(store, api_client) -> None:
    outsider = User.objects.create_user(username="outsider")
    client = APIClient()
    client.force_authenticate(outsider)

    response = _book(client, store)

    # Même réponse qu'un magasin inexistant : rien ne trahit son existence.
    assert response.status_code == status.HTTP_404_NOT_FOUND
    assert response.data == _book(api_client, Store(pk=uuid4())).data


def test_book_for_unknown_store(api_client) -> None:
    response = api_client.get(reverse("customer-list"), {"store_id": str(uuid4())})

    assert response.status_code == status.HTTP_404_NOT_FOUND


def test_quick_create_normalizes_and_returns_the_customer(api_client, store, cashier) -> None:
    response = api_client.post(
        reverse("customer-list"),
        {"store_id": str(store.pk), "name": " Awa  Diop ", "phone": "76 000 11 22"},
        format="json",
    )

    assert response.status_code == status.HTTP_201_CREATED, response.data
    assert response.data["name"] == "Awa Diop"
    assert response.data["phone"] == "+221760001122"
    assert response.data["balance"] == "0.00"
    assert Customer.objects.get().created_by == cashier


def test_quick_create_requires_a_phone(api_client, store) -> None:
    response = api_client.post(
        reverse("customer-list"), {"store_id": str(store.pk), "name": "Awa"}, format="json"
    )

    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert Customer.objects.count() == 0


def test_quick_create_rejects_invalid_phone(api_client, store) -> None:
    response = api_client.post(
        reverse("customer-list"),
        {"store_id": str(store.pk), "name": "Awa", "phone": "12"},
        format="json",
    )

    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert response.data["code"] == "INVALID_PHONE"


def test_quick_create_duplicate_returns_the_existing_customer(api_client, store) -> None:
    existing = create_customer(store=store, name="Moussa Fall", phone="771234567")
    record_opening_balance(customer=existing, amount=Decimal("5000"))
    record_adjustment(
        customer=existing, amount=Decimal("-1000"), reason="Versement",
        created_by=User.objects.create_user(username="gerant"),
    )

    response = api_client.post(
        reverse("customer-list"),
        {"store_id": str(store.pk), "name": "Moussa", "phone": "+221 77 123 45 67"},
        format="json",
    )

    assert response.status_code == status.HTTP_409_CONFLICT
    assert response.data["code"] == "CUSTOMER_DUPLICATE"
    assert response.data["customer"]["id"] == str(existing.pk)
    assert response.data["customer"]["balance"] == "4000.00"
    assert Customer.objects.count() == 1


def test_quick_create_requires_store_access(store) -> None:
    client = APIClient()
    client.force_authenticate(User.objects.create_user(username="outsider"))

    response = client.post(
        reverse("customer-list"),
        {"store_id": str(store.pk), "name": "Awa", "phone": "760001122"},
        format="json",
    )

    assert response.status_code == status.HTTP_404_NOT_FOUND
    assert response.data["code"] == "STORE_NOT_FOUND"
    assert Customer.objects.count() == 0


def test_customer_detail_returns_history_with_running_balance(api_client, store, cashier) -> None:
    manager = User.objects.create_user(username="gerant")
    customer = create_customer(store=store, name="Moussa Fall", phone="771234567")
    record_opening_balance(customer=customer, amount=Decimal("8500"), reference="ACCESS:1")
    session = CashSession.objects.create(
        cash_register=CashRegister.objects.create(store=store, name="Caisse 01"),
        cashier=cashier,
        opening_balance=Decimal("0"),
    )
    payment = record_customer_payment(
        customer=customer, cash_session=session, created_by=cashier, method="WAVE",
        amount=Decimal("2000"), idempotency_key=uuid4(),
    )
    record_adjustment(customer=customer, amount=Decimal("-500"), reason="Erreur papier", created_by=manager)

    response = api_client.get(reverse("customer-detail", kwargs={"pk": customer.pk}))

    assert response.status_code == status.HTTP_200_OK
    assert response.data["name"] == "Moussa Fall"
    assert response.data["balance"] == "6000.00"
    entries = response.data["entries"]
    assert [e["entry_type"] for e in entries] == ["ADJUSTMENT", "PAYMENT", "OPENING_BALANCE"]
    assert [e["running_balance"] for e in entries] == ["6000.00", "6500.00", "8500.00"]
    assert entries[0]["label"] == "Ajustement"
    assert entries[0]["reason"] == "Erreur papier"
    assert entries[0]["created_by"] == "gerant"
    assert entries[1]["amount"] == "-2000.00"
    assert entries[1]["customer_payment"] == {
        "id": payment.id, "reference": payment.reference, "method": "WAVE",
    }
    assert entries[2]["reference"] == "ACCESS:1"
    assert entries[2]["created_by"] is None


def test_customer_detail_requires_store_access(store) -> None:
    customer = create_customer(store=store, name="Moussa Fall", phone="771234567")
    client = APIClient()
    client.force_authenticate(User.objects.create_user(username="outsider"))

    response = client.get(reverse("customer-detail", kwargs={"pk": customer.pk}))

    assert response.status_code == status.HTTP_404_NOT_FOUND


def test_customer_detail_unknown(api_client) -> None:
    response = api_client.get(reverse("customer-detail", kwargs={"pk": uuid4()}))

    assert response.status_code == status.HTTP_404_NOT_FOUND
