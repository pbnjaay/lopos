"""Vente mise au cahier : `sum(paiements) + credit_amount == total`, client
obligatoire, écriture CREDIT_SALE créée dans la même transaction que la vente."""

from datetime import timedelta
from decimal import Decimal
from unittest.mock import patch
from uuid import uuid4

import pytest
from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from apps.cash.models import CashSession
from apps.catalog.models import Product
from apps.customers.models import Customer, CustomerLedgerEntry
from apps.customers.services import create_customer, customer_balance, record_adjustment
from apps.inventory.models import InventoryMovement, Stock
from apps.sales.exceptions import CustomerNotFound, InvalidCancellation, InvalidPayment, InvalidReturn
from apps.sales.models import Payment, Sale
from apps.sales.services import (
    cancel_sale,
    complete_offline_sale,
    complete_sale,
)
from apps.stores.models import CashRegister, Store, StoreAssignment
from apps.sync.services import SyncEventStatus, process_sale_completed_event


pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def no_manager_approval_threshold(settings):
    """Ce module teste le cahier et le tiroir, pas la validation par un
    gérant (voir test_cashier_approvals) : seuil hors d'atteinte."""
    settings.APPROVAL_AMOUNT_THRESHOLD = Decimal("1000000000")


User = get_user_model()
Type = CustomerLedgerEntry.EntryType


@pytest.fixture
def cashier():
    return User.objects.create_user(username="cashier")


@pytest.fixture
def store() -> Store:
    return Store.objects.create(name="Supérette Test")


@pytest.fixture
def cash_session(store: Store, cashier) -> CashSession:
    # Une caisse ne s'ouvre que dans un magasin où le caissier est affecté.
    StoreAssignment.objects.get_or_create(user=cashier, store=store)
    register = CashRegister.objects.create(store=store, name="Caisse 01")
    return CashSession.objects.create(
        cash_register=register, cashier=cashier, opening_balance=Decimal("15000.00")
    )


@pytest.fixture
def product(store: Store) -> Product:
    product = Product.objects.create(name="Sac de riz 5kg", selling_price=Decimal("5000.00"))
    Stock.objects.create(store=store, product=product, quantity=20)
    return product


@pytest.fixture
def customer(store: Store) -> Customer:
    return create_customer(store=store, name="Moussa Fall", phone="771234567")


def _cash(amount: str, received: str | None = None) -> dict:
    return {
        "method": Payment.Method.CASH,
        "amount": Decimal(amount),
        "received_amount": Decimal(received or amount),
    }


def _sell(cash_session, product, *, quantity=1, payments=(), customer=None, credit="0"):
    return complete_sale(
        cash_session=cash_session,
        items=[{"product_id": product.id, "quantity": quantity}],
        payments=list(payments),
        customer_id=customer.pk if customer else None,
        credit_amount=Decimal(credit),
    )


# --- vente à crédit (service) ----------------------------------------------


def test_full_credit_sale_has_no_payment_and_one_ledger_entry(
    cash_session, product, customer, cashier
) -> None:
    sale = _sell(cash_session, product, customer=customer, credit="5000")

    entry = CustomerLedgerEntry.objects.get()
    assert sale.customer == customer
    assert sale.credit_amount == Decimal("5000.00")
    assert sale.payments.count() == 0
    assert entry.entry_type == Type.CREDIT_SALE
    assert entry.amount == Decimal("5000.00")
    assert entry.sale == sale
    assert entry.store_id == customer.store_id
    assert entry.occurred_at == sale.occurred_at
    assert entry.created_by == cashier
    assert customer_balance(customer) == Decimal("5000.00")
    assert Stock.objects.get(product=product).quantity == 19


def test_partial_credit_sale(cash_session, product, customer) -> None:
    sale = _sell(
        cash_session, product, quantity=2,
        payments=[_cash("4000")], customer=customer, credit="6000",
    )

    assert sale.total == Decimal("10000.00")
    assert sale.payments.get().amount == Decimal("4000.00")
    assert customer_balance(customer) == Decimal("6000.00")


def test_split_payment_plus_credit(cash_session, product, customer) -> None:
    _sell(
        cash_session, product, quantity=2, customer=customer, credit="5000",
        payments=[_cash("3000"), {"method": Payment.Method.WAVE, "amount": Decimal("2000")}],
    )

    assert customer_balance(customer) == Decimal("5000.00")


def test_successive_credit_purchases_accumulate_without_blocking(
    cash_session, product, customer
) -> None:
    _sell(cash_session, product, customer=customer, credit="5000")
    _sell(cash_session, product, customer=customer, payments=[_cash("2000")], credit="3000")
    _sell(cash_session, product, customer=customer, payments=[_cash("3000")], credit="2000")

    assert customer_balance(customer) == Decimal("10000.00")
    assert CustomerLedgerEntry.objects.filter(entry_type=Type.CREDIT_SALE).count() == 3


def test_customer_on_a_fully_paid_sale_creates_no_ledger_entry(
    cash_session, product, customer
) -> None:
    sale = _sell(cash_session, product, customer=customer, payments=[_cash("5000")])

    assert sale.customer == customer
    assert sale.credit_amount == Decimal("0.00")
    assert CustomerLedgerEntry.objects.count() == 0


@pytest.mark.parametrize(
    ("payments", "credit", "with_customer"),
    [
        ([], "5000", False),  # crédit sans client
        ([_cash("4000")], "5000", True),  # 4 000 + 5 000 ≠ 10 000
        ([], "10001", True),  # crédit > total
        ([_cash("10000")], "-1", True),  # crédit négatif
        ([], "0", True),  # ni paiement ni crédit
        ([_cash("4000", received="5000")], "6000", True),  # monnaie rendue + dette
    ],
)
def test_invalid_credit_sales_are_rejected_and_leave_no_trace(
    cash_session, product, customer, payments, credit, with_customer
) -> None:
    with pytest.raises(InvalidPayment):
        _sell(
            cash_session, product, quantity=2, payments=payments,
            customer=customer if with_customer else None, credit=credit,
        )

    assert Sale.objects.count() == 0
    assert CustomerLedgerEntry.objects.count() == 0
    assert Stock.objects.get(product=product).quantity == 20


def test_customer_from_another_store_is_rejected(cash_session, product) -> None:
    elsewhere = create_customer(
        store=Store.objects.create(name="Autre boutique"), name="Awa", phone="760001122"
    )

    with pytest.raises(CustomerNotFound):
        _sell(cash_session, product, customer=elsewhere, credit="5000")

    assert Sale.objects.count() == 0


def test_inactive_customer_is_rejected_online(cash_session, product, customer) -> None:
    Customer.objects.filter(pk=customer.pk).update(is_active=False)

    with pytest.raises(InvalidPayment):
        _sell(cash_session, product, customer=customer, credit="5000")


def test_late_failure_rolls_back_sale_and_ledger_entry(cash_session, product, customer) -> None:
    with (
        patch.object(
            InventoryMovement.objects, "bulk_create", side_effect=RuntimeError("forced")
        ),
        pytest.raises(RuntimeError),
    ):
        _sell(cash_session, product, customer=customer, credit="5000")

    assert Sale.objects.count() == 0
    assert CustomerLedgerEntry.objects.count() == 0
    assert Stock.objects.get(product=product).quantity == 20


def test_database_requires_a_customer_for_credit(cash_session, cashier) -> None:
    with pytest.raises(IntegrityError), transaction.atomic():
        Sale.objects.create(
            cash_session=cash_session, cashier=cashier, subtotal=Decimal("100"),
            total=Decimal("100"), credit_amount=Decimal("100"), status=Sale.Status.COMPLETED,
        )


def test_database_caps_credit_at_total(cash_session, cashier, customer) -> None:
    with pytest.raises(IntegrityError), transaction.atomic():
        Sale.objects.create(
            cash_session=cash_session, cashier=cashier, subtotal=Decimal("100"),
            total=Decimal("100"), credit_amount=Decimal("101"), customer=customer,
            status=Sale.Status.COMPLETED,
        )


# --- hors ligne / synchronisation ------------------------------------------


def _offline_payload(cash_session, product, customer_id, credit="5000", payments=()):
    return {
        "cash_session_id": cash_session.id,
        "items": [{
            "product_id": product.id, "product_name": product.name,
            "unit_price": Decimal("5000.00"), "quantity": 1,
        }],
        "payments": list(payments),
        "customer_id": customer_id,
        "credit_amount": Decimal(credit),
    }


def test_offline_credit_sale_is_dated_when_it_happened(cash_session, product, customer) -> None:
    occurred_at = timezone.now() - timedelta(hours=3)

    sale, _ = complete_offline_sale(
        sale_id=uuid4(), cash_session=cash_session,
        items=_offline_payload(cash_session, product, customer.pk)["items"],
        payments=[], occurred_at=occurred_at,
        customer_id=customer.pk, credit_amount=Decimal("5000"),
    )

    assert CustomerLedgerEntry.objects.get(sale=sale).occurred_at == occurred_at


def test_offline_credit_sale_accepts_a_customer_deactivated_since(
    cash_session, product, customer
) -> None:
    Customer.objects.filter(pk=customer.pk).update(is_active=False)

    complete_offline_sale(
        sale_id=uuid4(), cash_session=cash_session,
        items=_offline_payload(cash_session, product, customer.pk)["items"],
        payments=[], occurred_at=timezone.now(),
        customer_id=customer.pk, credit_amount=Decimal("5000"),
    )

    assert customer_balance(customer) == Decimal("5000.00")


def test_replayed_credit_sale_event_writes_the_debt_once(
    cash_session, product, customer, cashier
) -> None:
    kwargs = dict(
        event_id=uuid4(), terminal_id=uuid4(), entity_id=uuid4(),
        occurred_at=timezone.now(), cashier=cashier,
        payload=_offline_payload(cash_session, product, customer.pk),
    )

    first = process_sale_completed_event(**kwargs)
    second = process_sale_completed_event(**kwargs)

    assert first.status == SyncEventStatus.SYNCED
    assert second.status == SyncEventStatus.ALREADY_PROCESSED
    assert CustomerLedgerEntry.objects.count() == 1
    assert customer_balance(customer) == Decimal("5000.00")


def test_sync_rejects_unknown_customer(cash_session, product, cashier) -> None:
    outcome = process_sale_completed_event(
        event_id=uuid4(), terminal_id=uuid4(), entity_id=uuid4(),
        occurred_at=timezone.now(), cashier=cashier,
        payload=_offline_payload(cash_session, product, uuid4()),
    )

    assert outcome.status == SyncEventStatus.REJECTED
    assert outcome.code == "CUSTOMER_NOT_FOUND"
    assert Sale.objects.count() == 0


def test_sync_push_api_accepts_a_full_credit_sale(cash_session, product, customer, cashier) -> None:
    client = APIClient()
    client.force_authenticate(cashier)

    response = client.post(
        reverse("sync-push"),
        {
            "terminal_id": str(uuid4()),
            "events": [{
                "event_id": str(uuid4()), "type": "SALE_COMPLETED",
                "entity_id": str(uuid4()), "occurred_at": timezone.now().isoformat(),
                "payload": {
                    "cash_session_id": str(cash_session.id),
                    "items": [{
                        "product_id": str(product.id), "product_name": product.name,
                        "unit_price": "5000.00", "quantity": 1,
                    }],
                    "payments": [],
                    "customer_id": str(customer.pk),
                    "credit_amount": "5000.00",
                },
            }],
        },
        format="json",
    )

    assert response.status_code == status.HTTP_200_OK
    assert response.data["results"][0]["status"] == "SYNCED"
    assert customer_balance(customer) == Decimal("5000.00")


# --- API de vente ----------------------------------------------------------


def test_sale_api_exposes_credit_and_customer(cash_session, product, customer, cashier) -> None:
    client = APIClient()
    client.force_authenticate(cashier)

    response = client.post(
        reverse("sale-complete"),
        {
            "cash_session_id": str(cash_session.id),
            "items": [{"product_id": str(product.id), "quantity": 2}],
            "payments": [{"method": "CASH", "amount": "4000.00", "received_amount": "4000.00"}],
            "customer_id": str(customer.pk),
            "credit_amount": "6000.00",
        },
        format="json",
    )

    assert response.status_code == status.HTTP_201_CREATED, response.data
    assert response.data["credit_amount"] == "6000.00"
    assert response.data["customer"] == {
        "id": str(customer.pk), "name": "Moussa Fall", "phone": "+221771234567",
    }


def test_sale_api_rejects_unknown_customer(cash_session, product, cashier) -> None:
    client = APIClient()
    client.force_authenticate(cashier)

    response = client.post(
        reverse("sale-complete"),
        {
            "cash_session_id": str(cash_session.id),
            "items": [{"product_id": str(product.id), "quantity": 1}],
            "payments": [],
            "customer_id": str(uuid4()),
            "credit_amount": "5000.00",
        },
        format="json",
    )

    assert response.status_code == status.HTTP_404_NOT_FOUND
    assert response.data["code"] == "CUSTOMER_NOT_FOUND"


def test_sale_without_credit_reports_zero_and_no_customer(cash_session, product, cashier) -> None:
    client = APIClient()
    client.force_authenticate(cashier)

    response = client.post(
        reverse("sale-complete"),
        {
            "cash_session_id": str(cash_session.id),
            "items": [{"product_id": str(product.id), "quantity": 1}],
            "payments": [{"method": "WAVE", "amount": "5000.00"}],
        },
        format="json",
    )

    assert response.status_code == status.HTTP_201_CREATED, response.data
    assert response.data["credit_amount"] == "0.00"
    assert response.data["customer"] is None


# --- annulation et retours -------------------------------------------------


def test_cancelling_a_credit_sale_reverses_the_debt(cash_session, product, customer, cashier) -> None:
    sale = _sell(cash_session, product, customer=customer, credit="5000")

    cancel_sale(sale_id=sale.id, cancelled_by=cashier, reason="Erreur de saisie")

    original = CustomerLedgerEntry.objects.get(entry_type=Type.CREDIT_SALE)
    reversal = CustomerLedgerEntry.objects.get(entry_type=Type.REVERSAL)
    assert original.amount == Decimal("5000.00")
    assert reversal.reversal_of == original
    assert reversal.amount == Decimal("-5000.00")
    assert customer_balance(customer) == Decimal("0.00")
    assert Stock.objects.get(product=product).quantity == 20


def test_cancelling_is_refused_once_the_customer_has_repaid(
    cash_session, product, customer, cashier
) -> None:
    manager = User.objects.create_user(username="gerant", is_staff=True)
    sale = _sell(cash_session, product, customer=customer, credit="5000")
    record_adjustment(customer=customer, amount=Decimal("-2000"), reason="Versement", created_by=manager)

    with pytest.raises(InvalidCancellation):
        cancel_sale(sale_id=sale.id, cancelled_by=cashier, reason="Erreur de saisie")

    sale.refresh_from_db()
    assert sale.status == Sale.Status.COMPLETED
    assert not CustomerLedgerEntry.objects.filter(entry_type=Type.REVERSAL).exists()
    assert Stock.objects.get(product=product).quantity == 19
    assert customer_balance(customer) == Decimal("3000.00")
