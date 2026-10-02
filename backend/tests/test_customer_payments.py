"""Remboursement client : CustomerPayment + écriture PAYMENT, en ligne, dans
une session ouverte, jamais plus que le solde dû ; impact sur la caisse."""

from decimal import Decimal
from uuid import uuid4

import pytest
from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient

from apps.cash.exceptions import CashSessionClosed
from apps.cash.models import CashSession
from apps.cash.services import close_cash_session, get_cash_session_summary
from apps.catalog.models import Product
from apps.customers.exceptions import CustomerOverpayment, InvalidCustomerPayment
from apps.customers.models import Customer, CustomerLedgerEntry, CustomerPayment
from apps.customers.services import (
    create_customer,
    customer_balance,
    record_customer_payment,
    record_opening_balance,
)
from apps.inventory.models import Stock
from apps.sales.models import Payment
from apps.sales.services import complete_sale
from apps.stores.models import CashRegister, Store, StoreAssignment


pytestmark = pytest.mark.django_db
User = get_user_model()


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
def customer(store: Store) -> Customer:
    customer = create_customer(store=store, name="Moussa Fall", phone="771234567")
    record_opening_balance(customer=customer, amount=Decimal("10000"))
    return customer


def _pay(customer, cash_session, cashier, *, amount, method="CASH", received=None, key=None):
    if method == "CASH" and received is None:
        received = Decimal(amount)
    return record_customer_payment(
        customer=customer,
        cash_session=cash_session,
        created_by=cashier,
        method=method,
        amount=Decimal(amount),
        received_amount=Decimal(received) if received is not None else None,
        idempotency_key=key or uuid4(),
    )


# --- service ---------------------------------------------------------------


def test_cash_repayment_reduces_balance_and_snapshots_it(customer, cash_session, cashier) -> None:
    payment = _pay(customer, cash_session, cashier, amount="4000", received="5000")

    entry = CustomerLedgerEntry.objects.get(entry_type=CustomerLedgerEntry.EntryType.PAYMENT)
    assert payment.reference.startswith("RMB-")
    assert payment.change_amount == Decimal("1000.00")
    assert payment.balance_before == Decimal("10000.00")
    assert payment.balance_after == Decimal("6000.00")
    assert payment.store_id == customer.store_id
    assert entry.customer_payment == payment
    assert entry.amount == Decimal("-4000.00")
    assert entry.occurred_at == payment.created_at
    assert entry.created_by == cashier
    assert customer_balance(customer) == Decimal("6000.00")


def test_mobile_repayment_has_no_cash_details(customer, cash_session, cashier) -> None:
    payment = _pay(customer, cash_session, cashier, amount="2500", method=Payment.Method.WAVE)

    assert payment.received_amount is None
    assert payment.change_amount is None
    assert customer_balance(customer) == Decimal("7500.00")


def test_full_repayment_settles_the_book(customer, cash_session, cashier) -> None:
    _pay(customer, cash_session, cashier, amount="10000")

    assert customer_balance(customer) == Decimal("0.00")


@pytest.mark.parametrize("amount", ["10000.01", "15000"])
def test_overpayment_is_refused_and_leaves_no_trace(customer, cash_session, cashier, amount) -> None:
    with pytest.raises(CustomerOverpayment) as excinfo:
        _pay(customer, cash_session, cashier, amount=amount)

    assert excinfo.value.balance == Decimal("10000.00")
    assert CustomerPayment.objects.count() == 0
    assert customer_balance(customer) == Decimal("10000.00")


def test_customer_with_nothing_due_cannot_pay(store, cash_session, cashier) -> None:
    settled = create_customer(store=store, name="Awa Diop", phone="760001122")

    with pytest.raises(CustomerOverpayment):
        _pay(settled, cash_session, cashier, amount="100")


def test_repayment_is_idempotent(customer, cash_session, cashier) -> None:
    key = uuid4()

    first = _pay(customer, cash_session, cashier, amount="4000", key=key)
    second = _pay(customer, cash_session, cashier, amount="4000", key=key)

    assert first.pk == second.pk
    assert CustomerPayment.objects.count() == 1
    assert customer_balance(customer) == Decimal("6000.00")


def test_idempotency_key_cannot_be_reused_for_another_customer(
    store, customer, cash_session, cashier
) -> None:
    key = uuid4()
    _pay(customer, cash_session, cashier, amount="1000", key=key)
    other = create_customer(store=store, name="Awa Diop", phone="760001122")
    record_opening_balance(customer=other, amount=Decimal("5000"))

    with pytest.raises(InvalidCustomerPayment):
        _pay(other, cash_session, cashier, amount="1000", key=key)


def test_repayment_requires_an_open_session(customer, cash_session, cashier) -> None:
    CashSession.objects.filter(pk=cash_session.pk).update(status=CashSession.Status.CLOSED)

    with pytest.raises(CashSessionClosed):
        _pay(customer, cash_session, cashier, amount="1000")


def test_repayment_requires_the_cashiers_own_session(customer, cash_session) -> None:
    intruder = User.objects.create_user(username="intruder")

    with pytest.raises(InvalidCustomerPayment):
        _pay(customer, cash_session, intruder, amount="1000")


def test_repayment_requires_a_customer_of_the_same_store(cash_session, cashier) -> None:
    elsewhere = create_customer(
        store=Store.objects.create(name="Autre boutique"), name="Awa", phone="760001122"
    )
    record_opening_balance(customer=elsewhere, amount=Decimal("5000"))

    with pytest.raises(InvalidCustomerPayment):
        _pay(elsewhere, cash_session, cashier, amount="1000")


@pytest.mark.parametrize(
    ("method", "amount", "received"),
    [
        ("CASH", Decimal("0"), Decimal("0")),
        ("CASH", Decimal("-100"), Decimal("0")),
        ("CASH", Decimal("1000"), None),  # espèces sans montant reçu
        ("CASH", Decimal("1000"), Decimal("500")),  # reçu insuffisant
        ("WAVE", Decimal("1000"), Decimal("1000")),  # mobile avec montant reçu
        ("CHEQUE", Decimal("1000"), None),
    ],
)
def test_invalid_repayments_are_rejected(customer, cash_session, cashier, method, amount, received) -> None:
    with pytest.raises(InvalidCustomerPayment):
        record_customer_payment(
            customer=customer, cash_session=cash_session, created_by=cashier,
            method=method, amount=amount, received_amount=received, idempotency_key=uuid4(),
        )

    assert CustomerPayment.objects.count() == 0


def test_deactivated_customer_can_still_repay(customer, cash_session, cashier) -> None:
    Customer.objects.filter(pk=customer.pk).update(is_active=False)

    _pay(customer, cash_session, cashier, amount="1000")

    assert customer_balance(customer) == Decimal("9000.00")


def test_database_refuses_an_inconsistent_balance_snapshot(customer, cash_session, cashier) -> None:
    with pytest.raises(IntegrityError), transaction.atomic():
        CustomerPayment.objects.create(
            customer=customer, store=customer.store, cash_session=cash_session,
            method="WAVE", amount=Decimal("1000"), balance_before=Decimal("500"),
            balance_after=Decimal("-500"), idempotency_key=uuid4(), created_by=cashier,
        )


# --- impact caisse / rapport Z --------------------------------------------


def test_cash_summary_separates_sales_credit_and_repayments(
    store, customer, cash_session, cashier
) -> None:
    product = Product.objects.create(name="Riz", selling_price=Decimal("5000.00"))
    Stock.objects.create(store=store, product=product, quantity=10)
    complete_sale(
        cash_session=cash_session,
        items=[{"product_id": product.id, "quantity": 1}],
        payments=[{"method": "CASH", "amount": Decimal("5000"), "received_amount": Decimal("5000")}],
    )
    complete_sale(
        cash_session=cash_session,
        items=[{"product_id": product.id, "quantity": 1}],
        payments=[{"method": "CASH", "amount": Decimal("2000"), "received_amount": Decimal("2000")}],
        customer_id=customer.pk,
        credit_amount=Decimal("3000"),
    )
    _pay(customer, cash_session, cashier, amount="4000", received="5000")
    _pay(customer, cash_session, cashier, amount="1000", method="WAVE")

    summary = get_cash_session_summary(cash_session=cash_session)

    assert summary.gross_sales == Decimal("10000.00")
    assert summary.cash_sales == Decimal("7000.00")
    assert summary.credit_sales == Decimal("3000.00")
    assert summary.cash_customer_payments == Decimal("4000.00")
    assert summary.wave_customer_payments == Decimal("1000.00")
    # Fond 15 000 + ventes espèces 7 000 + remboursement cahier espèces 4 000.
    # Ni le crédit ni le remboursement Wave ne sont des espèces.
    assert summary.expected_cash == Decimal("26000.00")


def test_closing_counts_cash_repayments_in_expected_cash(customer, cash_session, cashier) -> None:
    _pay(customer, cash_session, cashier, amount="4000")

    closed = close_cash_session(cash_session=cash_session, counted_cash=Decimal("19000"))

    assert closed.expected_balance == Decimal("19000.00")
    assert closed.difference == Decimal("0.00")


def test_summary_api_exposes_credit_and_repayments(customer, cash_session, cashier) -> None:
    _pay(customer, cash_session, cashier, amount="1500", method="ORANGE_MONEY")
    client = APIClient()
    client.force_authenticate(cashier)

    response = client.get(reverse("cash-session-summary", kwargs={"pk": cash_session.pk}))

    assert response.status_code == status.HTTP_200_OK
    assert response.data["credit_sales"] == "0.00"
    assert response.data["customer_payments"] == {
        "cash": "0.00", "wave": "0.00", "orange_money": "1500.00",
    }
    assert response.data["expected_cash"] == "15000.00"


# --- API -------------------------------------------------------------------


@pytest.fixture
def api_client(cashier) -> APIClient:
    client = APIClient()
    client.force_authenticate(cashier)
    return client


def _post_payment(api_client, customer, cash_session, **overrides):
    body = {
        "idempotency_key": str(uuid4()),
        "customer_id": str(customer.pk),
        "cash_session_id": str(cash_session.pk),
        "method": "CASH",
        "amount": "4000.00",
        "received_amount": "5000.00",
        **overrides,
    }
    return api_client.post(reverse("customer-payment-create"), body, format="json")


def test_payment_api_returns_the_receipt_data(api_client, customer, cash_session) -> None:
    response = _post_payment(api_client, customer, cash_session)

    assert response.status_code == status.HTTP_201_CREATED, response.data
    data = response.data
    assert data["reference"].startswith("RMB-")
    assert data["customer"] == {"id": str(customer.pk), "name": "Moussa Fall", "phone": "+221771234567"}
    assert data["store"]["name"] == "Supérette Test"
    assert data["cash_register"]["name"] == "Caisse 01"
    assert data["method"] == "CASH"
    assert data["amount"] == "4000.00"
    assert data["change_amount"] == "1000.00"
    assert data["balance_before"] == "10000.00"
    assert data["balance_after"] == "6000.00"
    assert data["created_by"] == "cashier"


def test_payment_api_replay_returns_the_same_payment(api_client, customer, cash_session) -> None:
    key = str(uuid4())

    first = _post_payment(api_client, customer, cash_session, idempotency_key=key)
    second = _post_payment(api_client, customer, cash_session, idempotency_key=key)

    assert first.status_code == second.status_code == status.HTTP_201_CREATED
    assert first.data["id"] == second.data["id"]
    assert customer_balance(customer) == Decimal("6000.00")


def test_payment_api_refuses_overpayment(api_client, customer, cash_session) -> None:
    response = _post_payment(
        api_client, customer, cash_session, amount="12000.00", received_amount="12000.00"
    )

    assert response.status_code == status.HTTP_409_CONFLICT
    assert response.data["code"] == "CUSTOMER_OVERPAYMENT"
    assert response.data["balance"] == "10000.00"


def test_payment_api_refuses_a_colleagues_session(customer, cash_session, store) -> None:
    colleague = User.objects.create_user(username="colleague")
    StoreAssignment.objects.create(user=colleague, store=store)
    client = APIClient()
    client.force_authenticate(colleague)

    response = _post_payment(client, customer, cash_session)

    assert response.status_code == status.HTTP_403_FORBIDDEN
    assert response.data["code"] == "CASH_SESSION_NOT_OWNED"


def test_payment_api_treats_another_stores_customer_and_session_as_unknown(
    customer, cash_session
) -> None:
    client = APIClient()
    client.force_authenticate(User.objects.create_user(username="intruder"))

    response = _post_payment(client, customer, cash_session)

    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert set(response.data) == {"customer_id", "cash_session_id"}
    assert not CustomerPayment.objects.exists()


def test_payment_api_rejects_invalid_details(api_client, customer, cash_session) -> None:
    response = _post_payment(api_client, customer, cash_session, received_amount="100.00")

    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert response.data["code"] == "INVALID_CUSTOMER_PAYMENT"


def test_payment_detail_is_scoped_to_the_store(api_client, customer, cash_session, cashier) -> None:
    payment = _pay(customer, cash_session, cashier, amount="1000")
    url = reverse("customer-payment-detail", kwargs={"pk": payment.pk})

    assert api_client.get(url).status_code == status.HTTP_200_OK

    other_cashier = User.objects.create_user(username="other")
    other_store = Store.objects.create(name="Autre boutique")
    StoreAssignment.objects.create(user=other_cashier, store=other_store)
    other_register = CashRegister.objects.create(store=other_store, name="Caisse 01")
    CashSession.objects.create(
        cash_register=other_register, cashier=other_cashier, opening_balance=Decimal("0")
    )
    other_client = APIClient()
    other_client.force_authenticate(other_cashier)

    assert other_client.get(url).status_code == status.HTTP_404_NOT_FOUND
