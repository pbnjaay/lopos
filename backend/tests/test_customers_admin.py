from decimal import Decimal

import pytest
from django.contrib import admin
from django.contrib.auth import get_user_model
from django.test import RequestFactory
from django.urls import reverse

from apps.customers.admin import CustomerAdmin, CustomerLedgerEntryAdmin
from apps.customers.models import Customer, CustomerLedgerEntry
from apps.customers.services import create_customer, customer_balance, record_opening_balance
from apps.stores.models import Store


pytestmark = pytest.mark.django_db
User = get_user_model()


@pytest.fixture
def store() -> Store:
    return Store.objects.create(name="Supérette Test")


@pytest.fixture
def admin_client(client):
    user = User.objects.create_superuser(username="admin", password="pw")
    client.force_login(user)
    client.user = user
    return client


@pytest.fixture
def customer(store: Store) -> Customer:
    return create_customer(store=store, name="Moussa Fall", phone="771234567")


def test_ledger_entries_are_never_editable_or_deletable() -> None:
    model_admin = CustomerLedgerEntryAdmin(CustomerLedgerEntry, admin.site)
    request = RequestFactory().get("/admin/")
    request.user = User.objects.create_superuser(username="root")

    assert model_admin.has_change_permission(request) is False
    assert model_admin.has_delete_permission(request) is False


def test_customers_are_never_deletable() -> None:
    model_admin = CustomerAdmin(Customer, admin.site)
    request = RequestFactory().get("/admin/")
    request.user = User.objects.create_superuser(username="root")

    assert model_admin.has_delete_permission(request) is False


def test_customer_admin_normalizes_phone(admin_client, store: Store) -> None:
    response = admin_client.post(
        reverse("admin:customers_customer_add"),
        {"store": store.pk, "name": " Awa  Diop ", "phone": "76 000 11 22", "notes": "", "is_active": "on",
         "ledger_entries-TOTAL_FORMS": "0", "ledger_entries-INITIAL_FORMS": "0"},
    )

    assert response.status_code == 302, response.content
    customer = Customer.objects.get()
    assert customer.name == "Awa Diop"
    assert customer.phone == "+221760001122"
    assert customer.created_by == admin_client.user


def test_customer_admin_rejects_duplicate_phone(admin_client, store: Store, customer: Customer) -> None:
    response = admin_client.post(
        reverse("admin:customers_customer_add"),
        {"store": store.pk, "name": "Autre", "phone": "+221 77 123 45 67", "notes": "", "is_active": "on",
         "ledger_entries-TOTAL_FORMS": "0", "ledger_entries-INITIAL_FORMS": "0"},
    )

    assert response.status_code == 200
    assert Customer.objects.count() == 1


def test_customer_changelist_shows_balance_and_filters(admin_client, store: Store, customer: Customer) -> None:
    create_customer(store=store, name="Awa Diop", phone="760001122")
    record_opening_balance(customer=customer, amount=Decimal("18500"))

    response = admin_client.get(reverse("admin:customers_customer_changelist") + "?balance=due")

    assert response.status_code == 200
    content = response.content.decode()
    assert "Moussa Fall" in content
    assert "18 500 FCFA" in content
    assert "Awa Diop" not in content


def test_manual_adjustment_goes_through_the_service(admin_client, customer: Customer) -> None:
    response = admin_client.post(
        reverse("admin:customers_customerledgerentry_add"),
        {"customer": customer.pk, "entry_type": "ADJUSTMENT", "amount": "1500",
         "reason": "Papier = 15 000", "reference": ""},
    )

    assert response.status_code == 302, response.content
    entry = CustomerLedgerEntry.objects.get()
    assert entry.entry_type == CustomerLedgerEntry.EntryType.ADJUSTMENT
    assert entry.amount == Decimal("1500.00")
    assert entry.store_id == customer.store_id
    assert entry.created_by == admin_client.user


def test_manual_opening_balance(admin_client, customer: Customer) -> None:
    response = admin_client.post(
        reverse("admin:customers_customerledgerentry_add"),
        {"customer": customer.pk, "entry_type": "OPENING_BALANCE", "amount": "18500",
         "reason": "", "reference": "ACCESS:42"},
    )

    assert response.status_code == 302, response.content
    assert customer_balance(customer) == Decimal("18500.00")


@pytest.mark.parametrize(
    "data",
    [
        {"entry_type": "ADJUSTMENT", "amount": "1500", "reason": ""},
        {"entry_type": "ADJUSTMENT", "amount": "-100", "reason": "Trop"},
        {"entry_type": "ADJUSTMENT", "amount": "0", "reason": "Rien"},
        {"entry_type": "OPENING_BALANCE", "amount": "-100", "reason": ""},
        {"entry_type": "CREDIT_SALE", "amount": "100", "reason": ""},
        {"entry_type": "REVERSAL", "amount": "-100", "reason": "x"},
    ],
)
def test_manual_entry_form_rejects_invalid_input(admin_client, customer: Customer, data: dict) -> None:
    response = admin_client.post(
        reverse("admin:customers_customerledgerentry_add"),
        {"customer": customer.pk, "reference": "", **data},
    )

    assert response.status_code == 200
    assert CustomerLedgerEntry.objects.count() == 0


def test_second_opening_balance_is_rejected_by_the_form(admin_client, customer: Customer) -> None:
    record_opening_balance(customer=customer, amount=Decimal("1000"))

    response = admin_client.post(
        reverse("admin:customers_customerledgerentry_add"),
        {"customer": customer.pk, "entry_type": "OPENING_BALANCE", "amount": "500",
         "reason": "", "reference": ""},
    )

    assert response.status_code == 200
    assert CustomerLedgerEntry.objects.count() == 1
