from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from threading import Barrier
from uuid import uuid4

import pytest
from django.contrib.auth import get_user_model
from django.db import close_old_connections, connection, connections

from apps.cash.models import CashSession
from apps.customers.exceptions import CustomerOverpayment, NegativeCustomerBalance
from apps.customers.models import Customer
from apps.customers.services import (
    create_customer,
    customer_balance,
    record_adjustment,
    record_customer_payment,
    record_opening_balance,
)
from apps.stores.models import CashRegister, Store


User = get_user_model()


def _attempt_decrease(*, customer_id, manager_id, start_barrier: Barrier) -> str:
    close_old_connections()
    try:
        customer = Customer.objects.get(pk=customer_id)
        manager = User.objects.get(pk=manager_id)
        start_barrier.wait(timeout=10)
        try:
            record_adjustment(
                customer=customer,
                amount=Decimal("-6000"),
                reason="Paiement noté sur le cahier papier",
                created_by=manager,
            )
        except NegativeCustomerBalance:
            return "rejected"
        return "recorded"
    finally:
        connections["default"].close()


@pytest.mark.django_db(transaction=True)
def test_concurrent_decreases_cannot_push_balance_below_zero() -> None:
    """
    Deux caisses qui font baisser le même cahier en même temps : sans le
    SELECT … FOR UPDATE sur la ligne client, chacune lirait un solde de
    10 000 et les deux écritures de −6 000 passeraient (solde −2 000). Le
    verrou force la seconde à relire le solde après le commit de la
    première, et à être refusée.
    """
    assert connection.vendor == "postgresql"

    store = Store.objects.create(name="Supérette Test")
    manager = User.objects.create_user(username="gerant", is_staff=True)
    customer = create_customer(store=store, name="Moussa Fall", phone="771234567")
    record_opening_balance(customer=customer, amount=Decimal("10000"), created_by=manager)

    barrier = Barrier(2)
    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [
            executor.submit(
                _attempt_decrease,
                customer_id=customer.pk,
                manager_id=manager.pk,
                start_barrier=barrier,
            )
            for _ in range(2)
        ]
        outcomes = sorted(future.result(timeout=30) for future in futures)

    assert outcomes == ["recorded", "rejected"]
    assert customer_balance(customer) == Decimal("4000.00")


def _attempt_repayment(*, customer_id, cash_session_id, cashier_id, start_barrier: Barrier) -> str:
    close_old_connections()
    try:
        customer = Customer.objects.get(pk=customer_id)
        cash_session = CashSession.objects.get(pk=cash_session_id)
        cashier = User.objects.get(pk=cashier_id)
        start_barrier.wait(timeout=10)
        try:
            record_customer_payment(
                customer=customer,
                cash_session=cash_session,
                created_by=cashier,
                method="WAVE",
                amount=Decimal("6000"),
                idempotency_key=uuid4(),
            )
        except CustomerOverpayment:
            return "rejected"
        return "recorded"
    finally:
        connections["default"].close()


@pytest.mark.django_db(transaction=True)
def test_concurrent_repayments_cannot_overpay() -> None:
    """
    Deux caisses encaissent le même client au même moment, chacune pour
    6 000 sur un solde de 10 000. Deux sessions distinctes : seul le verrou
    sur la ligne client les sérialise, et la seconde voit le solde réduit.
    """
    assert connection.vendor == "postgresql"

    store = Store.objects.create(name="Supérette Test")
    customer = create_customer(store=store, name="Moussa Fall", phone="771234567")
    record_opening_balance(customer=customer, amount=Decimal("10000"))
    sessions = []
    for index in (1, 2):
        cashier = User.objects.create_user(username=f"cashier{index}")
        register = CashRegister.objects.create(store=store, name=f"Caisse 0{index}")
        sessions.append(
            CashSession.objects.create(
                cash_register=register, cashier=cashier, opening_balance=Decimal("0")
            )
        )

    barrier = Barrier(2)
    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [
            executor.submit(
                _attempt_repayment,
                customer_id=customer.pk,
                cash_session_id=session.pk,
                cashier_id=session.cashier_id,
                start_barrier=barrier,
            )
            for session in sessions
        ]
        outcomes = sorted(future.result(timeout=30) for future in futures)

    assert outcomes == ["recorded", "rejected"]
    assert customer_balance(customer) == Decimal("4000.00")
