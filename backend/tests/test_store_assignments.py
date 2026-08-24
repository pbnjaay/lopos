from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient

from apps.cash.exceptions import CashRegisterNotAllowed, StoreInactive
from apps.cash.services import open_cash_session
from apps.stores.models import CashRegister, Store, StoreAssignment


pytestmark = pytest.mark.django_db
User = get_user_model()


@pytest.fixture
def cashier():
    return User.objects.create_user(username="cashier")


@pytest.fixture
def client(cashier) -> APIClient:
    api_client = APIClient()
    api_client.force_authenticate(cashier)
    return api_client


def test_store_assignment_is_unique(cashier) -> None:
    store = Store.objects.create(name="Louga")
    StoreAssignment.objects.create(user=cashier, store=store)

    with pytest.raises(IntegrityError), transaction.atomic():
        StoreAssignment.objects.create(user=cashier, store=store)


def test_cashier_lists_only_active_assigned_stores_and_registers(
    client: APIClient,
    cashier,
) -> None:
    assigned = Store.objects.create(name="Louga")
    forbidden = Store.objects.create(name="Dakar")
    inactive = Store.objects.create(name="Thiès", is_active=False)
    StoreAssignment.objects.create(user=cashier, store=assigned)
    StoreAssignment.objects.create(user=cashier, store=inactive)
    allowed_register = CashRegister.objects.create(store=assigned, name="Caisse 01")
    CashRegister.objects.create(store=assigned, name="Caisse inactive", is_active=False)
    CashRegister.objects.create(store=forbidden, name="Caisse 02")
    CashRegister.objects.create(store=inactive, name="Caisse 03")

    stores_response = client.get(reverse("store-list"))
    registers_response = client.get(reverse("cash-register-list"))

    assert stores_response.status_code == status.HTTP_200_OK
    assert [row["id"] for row in stores_response.json()] == [str(assigned.id)]
    assert registers_response.status_code == status.HTTP_200_OK
    assert [row["id"] for row in registers_response.json()] == [
        str(allowed_register.id)
    ]


def test_cash_register_list_can_be_filtered_by_assigned_store(
    client: APIClient,
    cashier,
) -> None:
    louga = Store.objects.create(name="Louga")
    dakar = Store.objects.create(name="Dakar")
    StoreAssignment.objects.bulk_create(
        [
            StoreAssignment(user=cashier, store=louga),
            StoreAssignment(user=cashier, store=dakar),
        ]
    )
    louga_register = CashRegister.objects.create(store=louga, name="Caisse Louga")
    CashRegister.objects.create(store=dakar, name="Caisse Dakar")

    response = client.get(reverse("cash-register-list"), {"store_id": louga.id})

    assert response.status_code == status.HTTP_200_OK
    assert [row["id"] for row in response.json()] == [str(louga_register.id)]


def test_staff_lists_all_stores_and_registers() -> None:
    staff = User.objects.create_user(username="manager", is_staff=True)
    active = Store.objects.create(name="Louga")
    inactive = Store.objects.create(name="Dakar", is_active=False)
    CashRegister.objects.create(store=active, name="Caisse 01")
    CashRegister.objects.create(store=inactive, name="Caisse inactive", is_active=False)
    client = APIClient()
    client.force_authenticate(staff)

    assert len(client.get(reverse("store-list")).json()) == 2
    assert len(client.get(reverse("cash-register-list")).json()) == 2


def test_opening_rejects_a_register_outside_cashier_assignment(cashier) -> None:
    store = Store.objects.create(name="Dakar")
    cash_register = CashRegister.objects.create(store=store, name="Caisse 01")

    with pytest.raises(CashRegisterNotAllowed):
        open_cash_session(
            cash_register=cash_register,
            cashier=cashier,
            opening_balance=Decimal("15000.00"),
        )


def test_opening_rejects_an_inactive_assigned_store(cashier) -> None:
    store = Store.objects.create(name="Louga", is_active=False)
    StoreAssignment.objects.create(user=cashier, store=store)
    cash_register = CashRegister.objects.create(store=store, name="Caisse 01")

    with pytest.raises(StoreInactive):
        open_cash_session(
            cash_register=cash_register,
            cashier=cashier,
            opening_balance=Decimal("15000.00"),
        )


def test_api_opening_returns_403_for_an_unassigned_register(client: APIClient) -> None:
    store = Store.objects.create(name="Dakar")
    cash_register = CashRegister.objects.create(store=store, name="Caisse 01")

    response = client.post(
        reverse("cash-session-open"),
        {
            "cash_register_id": cash_register.id,
            "opening_balance": "15000.00",
        },
        format="json",
    )

    assert response.status_code == status.HTTP_403_FORBIDDEN
    assert response.json() == {
        "code": "CASH_REGISTER_NOT_ALLOWED",
        "message": "Vous n’êtes pas autorisé à travailler dans cette boutique.",
    }
