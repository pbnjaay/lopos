from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model

from apps.customers.exceptions import (
    DuplicateCustomer,
    InvalidCustomer,
    InvalidLedgerEntry,
    InvalidPhone,
    NegativeCustomerBalance,
)
from apps.customers.models import Customer, CustomerLedgerEntry
from apps.customers.services import (
    create_customer,
    customer_balance,
    record_adjustment,
    record_opening_balance,
    reverse_ledger_entry,
    with_balance,
)
from apps.stores.models import Store


pytestmark = pytest.mark.django_db
User = get_user_model()
Type = CustomerLedgerEntry.EntryType


@pytest.fixture
def store() -> Store:
    return Store.objects.create(name="Supérette Test")


@pytest.fixture
def manager():
    return User.objects.create_user(username="gerant", is_staff=True)


@pytest.fixture
def customer(store: Store, manager) -> Customer:
    return create_customer(
        store=store, name="Moussa Fall", phone="77 123 45 67", created_by=manager
    )


# --- create_customer -------------------------------------------------------


def test_create_customer_normalizes_name_and_phone(store: Store, manager) -> None:
    customer = create_customer(
        store=store, name="  Awa   Diop ", phone="+221 76 000 11 22", created_by=manager
    )

    assert customer.name == "Awa Diop"
    assert customer.phone == "+221760001122"
    assert customer.created_by == manager
    assert customer_balance(customer) == Decimal("0.00")


def test_create_customer_without_phone(store: Store) -> None:
    customer = create_customer(store=store, name="La voisine", phone=None)
    blank = create_customer(store=store, name="Le gardien", phone="   ")

    assert customer.phone is None
    assert blank.phone is None


def test_create_customer_rejects_duplicate_phone_in_same_store(
    store: Store, customer: Customer
) -> None:
    with pytest.raises(DuplicateCustomer) as excinfo:
        create_customer(store=store, name="Autre nom", phone="+221771234567")

    assert excinfo.value.existing == customer
    assert Customer.objects.count() == 1


def test_same_phone_is_allowed_in_another_store(customer: Customer) -> None:
    other_store = Store.objects.create(name="Autre boutique")

    other = create_customer(store=other_store, name="Moussa Fall", phone="771234567")

    assert other.pk != customer.pk


def test_same_name_without_duplicate_phone_is_allowed(
    store: Store, customer: Customer
) -> None:
    homonym = create_customer(store=store, name="Moussa Fall", phone="78 000 00 00")

    assert homonym.pk != customer.pk


def test_create_customer_rejects_empty_name(store: Store) -> None:
    with pytest.raises(InvalidCustomer):
        create_customer(store=store, name="   ", phone="771234567")


def test_create_customer_rejects_invalid_phone(store: Store) -> None:
    with pytest.raises(InvalidPhone):
        create_customer(store=store, name="Awa", phone="12")


# --- balance ---------------------------------------------------------------


def test_balance_is_the_sum_of_entries(customer: Customer, manager) -> None:
    record_opening_balance(customer=customer, amount=Decimal("18500"), created_by=manager)
    record_adjustment(
        customer=customer, amount=Decimal("-500"), reason="Erreur papier", created_by=manager
    )
    record_adjustment(
        customer=customer, amount=1500, reason="Oubli du 12/09", created_by=manager
    )

    assert customer_balance(customer) == Decimal("19500.00")


def test_with_balance_annotates_every_customer(
    store: Store, customer: Customer, manager
) -> None:
    settled = create_customer(store=store, name="Awa Diop", phone="760001122")
    record_opening_balance(customer=customer, amount=Decimal("5000"), created_by=manager)

    balances = {c.pk: c.balance for c in with_balance(Customer.objects.all())}

    assert balances == {customer.pk: Decimal("5000.00"), settled.pk: Decimal("0.00")}


# --- opening balance -------------------------------------------------------


def test_record_opening_balance(customer: Customer, manager) -> None:
    entry = record_opening_balance(
        customer=customer,
        amount=Decimal("18500"),
        reference="ACCESS:1234",
        created_by=manager,
    )

    assert entry.entry_type == Type.OPENING_BALANCE
    assert entry.amount == Decimal("18500.00")
    assert entry.store_id == customer.store_id
    assert entry.reference == "ACCESS:1234"
    assert entry.created_by == manager


def test_opening_balance_cannot_be_recorded_twice(customer: Customer, manager) -> None:
    record_opening_balance(customer=customer, amount=Decimal("18500"), created_by=manager)

    with pytest.raises(InvalidLedgerEntry):
        record_opening_balance(customer=customer, amount=Decimal("18500"), created_by=manager)

    assert customer_balance(customer) == Decimal("18500.00")


@pytest.mark.parametrize("amount", [0, -100, Decimal("-0.01"), 1.5, True, "100"])
def test_opening_balance_rejects_invalid_amount(customer: Customer, amount) -> None:
    with pytest.raises(InvalidLedgerEntry):
        record_opening_balance(customer=customer, amount=amount)

    assert CustomerLedgerEntry.objects.count() == 0


def test_amount_with_more_than_two_decimals_is_rejected(customer: Customer) -> None:
    with pytest.raises(InvalidLedgerEntry):
        record_opening_balance(customer=customer, amount=Decimal("100.005"))


# --- adjustment ------------------------------------------------------------


def test_adjustment_requires_a_reason(customer: Customer, manager) -> None:
    with pytest.raises(InvalidLedgerEntry):
        record_adjustment(customer=customer, amount=1500, reason="  ", created_by=manager)


def test_adjustment_cannot_be_zero(customer: Customer, manager) -> None:
    with pytest.raises(InvalidLedgerEntry):
        record_adjustment(customer=customer, amount=0, reason="Rien", created_by=manager)


def test_adjustment_cannot_make_balance_negative(customer: Customer, manager) -> None:
    record_opening_balance(customer=customer, amount=Decimal("1000"), created_by=manager)

    with pytest.raises(NegativeCustomerBalance):
        record_adjustment(
            customer=customer, amount=Decimal("-1000.01"), reason="Trop", created_by=manager
        )

    entry = record_adjustment(
        customer=customer, amount=Decimal("-1000"), reason="Soldé", created_by=manager
    )
    assert entry.reason == "Soldé"
    assert customer_balance(customer) == Decimal("0.00")


# --- reversal --------------------------------------------------------------


def test_reversal_cancels_an_entry_and_keeps_the_original(
    customer: Customer, manager
) -> None:
    original = record_adjustment(
        customer=customer, amount=Decimal("2500"), reason="Achat oublié", created_by=manager
    )

    reversal = reverse_ledger_entry(
        entry=original, reason="Achat déjà noté", created_by=manager
    )

    original.refresh_from_db()
    assert original.amount == Decimal("2500.00")
    assert reversal.entry_type == Type.REVERSAL
    assert reversal.amount == Decimal("-2500.00")
    assert reversal.reversal_of == original
    assert customer_balance(customer) == Decimal("0.00")


def test_entry_cannot_be_reversed_twice(customer: Customer, manager) -> None:
    original = record_adjustment(
        customer=customer, amount=Decimal("2500"), reason="x", created_by=manager
    )
    reverse_ledger_entry(entry=original, reason="Erreur", created_by=manager)

    with pytest.raises(InvalidLedgerEntry):
        reverse_ledger_entry(entry=original, reason="Encore", created_by=manager)


def test_reversal_cannot_be_reversed(customer: Customer, manager) -> None:
    original = record_adjustment(
        customer=customer, amount=Decimal("2500"), reason="x", created_by=manager
    )
    reversal = reverse_ledger_entry(entry=original, reason="Erreur", created_by=manager)

    with pytest.raises(InvalidLedgerEntry):
        reverse_ledger_entry(entry=reversal, reason="Annuler l'annulation", created_by=manager)


def test_reversal_requires_a_reason(customer: Customer, manager) -> None:
    original = record_adjustment(
        customer=customer, amount=Decimal("2500"), reason="x", created_by=manager
    )

    with pytest.raises(InvalidLedgerEntry):
        reverse_ledger_entry(entry=original, reason="", created_by=manager)


def test_reversal_cannot_make_balance_negative(customer: Customer, manager) -> None:
    opening = record_opening_balance(
        customer=customer, amount=Decimal("5000"), created_by=manager
    )
    record_adjustment(
        customer=customer, amount=Decimal("-3000"), reason="Payé sur papier", created_by=manager
    )

    with pytest.raises(NegativeCustomerBalance):
        reverse_ledger_entry(entry=opening, reason="Erreur de reprise", created_by=manager)

    assert customer_balance(customer) == Decimal("2000.00")
