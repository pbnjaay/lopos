from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.db.models.deletion import ProtectedError

from apps.cash.models import CashSession
from apps.customers.exceptions import ImmutableLedgerEntry
from apps.customers.models import Customer, CustomerLedgerEntry
from apps.sales.models import Sale
from apps.stores.models import CashRegister, Store


pytestmark = pytest.mark.django_db
User = get_user_model()
Type = CustomerLedgerEntry.EntryType


@pytest.fixture
def store() -> Store:
    return Store.objects.create(name="Supérette Test")


@pytest.fixture
def customer(store: Store) -> Customer:
    return Customer.objects.create(store=store, name="Moussa Fall", phone="+221771234567")


@pytest.fixture
def sale(store: Store) -> Sale:
    cashier = User.objects.create_user(username="cashier")
    register = CashRegister.objects.create(store=store, name="Caisse 01")
    session = CashSession.objects.create(
        cash_register=register, cashier=cashier, opening_balance=Decimal("0")
    )
    return Sale.objects.create(
        cash_session=session,
        cashier=cashier,
        subtotal=Decimal("5000.00"),
        total=Decimal("5000.00"),
        status=Sale.Status.COMPLETED,
    )


def _entry(customer: Customer, **kwargs) -> CustomerLedgerEntry:
    return CustomerLedgerEntry.objects.create(
        customer=customer, store_id=customer.store_id, **kwargs
    )


def test_phone_is_unique_per_store_but_not_across_stores(
    store: Store, customer: Customer
) -> None:
    other_store = Store.objects.create(name="Autre boutique")
    Customer.objects.create(store=other_store, name="Moussa Fall", phone=customer.phone)

    with pytest.raises(IntegrityError), transaction.atomic():
        Customer.objects.create(store=store, name="Autre Moussa", phone=customer.phone)


def test_several_customers_without_phone_are_allowed(store: Store) -> None:
    Customer.objects.create(store=store, name="La voisine")
    Customer.objects.create(store=store, name="Le gardien")

    assert Customer.objects.filter(phone__isnull=True).count() == 2


def test_customer_phone_must_be_normalized(store: Store) -> None:
    with pytest.raises(IntegrityError), transaction.atomic():
        Customer.objects.create(store=store, name="Awa", phone="771234567")


def test_customer_name_cannot_be_empty(store: Store) -> None:
    with pytest.raises(IntegrityError), transaction.atomic():
        Customer.objects.create(store=store, name="")


@pytest.mark.parametrize(
    "kwargs",
    [
        {"entry_type": Type.CREDIT_SALE, "amount": Decimal("5000")},  # sans vente
        {"entry_type": Type.OPENING_BALANCE, "amount": Decimal("-100")},
        {"entry_type": Type.PAYMENT, "amount": Decimal("100")},
        {"entry_type": Type.ADJUSTMENT, "amount": Decimal("100")},  # sans motif
        {"entry_type": Type.REVERSAL, "amount": Decimal("-100"), "reason": "x"},  # sans cible
        {"entry_type": Type.OPENING_BALANCE, "amount": Decimal("0")},
        {"entry_type": "UNKNOWN", "amount": Decimal("100"), "reason": "x"},
    ],
)
def test_entry_type_rules_are_enforced_by_the_database(
    customer: Customer, kwargs: dict
) -> None:
    with pytest.raises(IntegrityError), transaction.atomic():
        _entry(customer, **kwargs)


def test_credit_sale_entry_requires_positive_amount(customer: Customer, sale: Sale) -> None:
    with pytest.raises(IntegrityError), transaction.atomic():
        _entry(customer, entry_type=Type.CREDIT_SALE, amount=Decimal("-5000"), sale=sale)

    entry = _entry(customer, entry_type=Type.CREDIT_SALE, amount=Decimal("5000"), sale=sale)
    assert entry.pk is not None


def test_a_sale_has_at_most_one_credit_entry(customer: Customer, sale: Sale) -> None:
    _entry(customer, entry_type=Type.CREDIT_SALE, amount=Decimal("5000"), sale=sale)

    with pytest.raises(IntegrityError), transaction.atomic():
        _entry(customer, entry_type=Type.CREDIT_SALE, amount=Decimal("5000"), sale=sale)


def test_a_customer_has_at_most_one_opening_balance(customer: Customer) -> None:
    _entry(customer, entry_type=Type.OPENING_BALANCE, amount=Decimal("18500"))

    with pytest.raises(IntegrityError), transaction.atomic():
        _entry(customer, entry_type=Type.OPENING_BALANCE, amount=Decimal("100"))


def test_an_entry_can_be_reversed_only_once(customer: Customer) -> None:
    original = _entry(customer, entry_type=Type.OPENING_BALANCE, amount=Decimal("1000"))
    _entry(
        customer,
        entry_type=Type.REVERSAL,
        amount=Decimal("-1000"),
        reversal_of=original,
        reason="Erreur de saisie",
    )

    with pytest.raises(IntegrityError), transaction.atomic():
        _entry(
            customer,
            entry_type=Type.REVERSAL,
            amount=Decimal("-1000"),
            reversal_of=original,
            reason="Encore",
        )


def test_ledger_entry_cannot_be_updated(customer: Customer) -> None:
    entry = _entry(customer, entry_type=Type.OPENING_BALANCE, amount=Decimal("1000"))

    entry.amount = Decimal("2000")
    with pytest.raises(ImmutableLedgerEntry):
        entry.save()
    with pytest.raises(ImmutableLedgerEntry):
        CustomerLedgerEntry.objects.filter(pk=entry.pk).update(amount=Decimal("2000"))

    entry.refresh_from_db()
    assert entry.amount == Decimal("1000.00")


def test_ledger_entry_cannot_be_deleted(customer: Customer) -> None:
    entry = _entry(customer, entry_type=Type.OPENING_BALANCE, amount=Decimal("1000"))

    with pytest.raises(ImmutableLedgerEntry):
        entry.delete()
    with pytest.raises(ImmutableLedgerEntry):
        CustomerLedgerEntry.objects.filter(pk=entry.pk).delete()

    assert CustomerLedgerEntry.objects.filter(pk=entry.pk).exists()


def test_customer_with_history_cannot_be_deleted(customer: Customer) -> None:
    _entry(customer, entry_type=Type.OPENING_BALANCE, amount=Decimal("1000"))

    with pytest.raises(ProtectedError):
        customer.delete()
