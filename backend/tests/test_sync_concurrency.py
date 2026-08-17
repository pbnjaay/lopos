from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from threading import Barrier
from uuid import uuid4

import pytest
from django.contrib.auth import get_user_model
from django.db import close_old_connections, connection, connections
from django.utils import timezone

from apps.cash.models import CashSession
from apps.catalog.models import Product
from apps.inventory.models import InventoryMovement, Stock
from apps.sales.models import Payment, Sale, SaleItem
from apps.stores.models import CashRegister, Store
from apps.sync.models import ProcessedSyncEvent
from apps.sync.services import SyncEventStatus, process_sale_completed_event

User = get_user_model()


def _payload(*, cash_session_id, product_id, product_name, unit_price, quantity):
    return {
        "cash_session_id": cash_session_id,
        "items": [
            {
                "product_id": product_id,
                "product_name": product_name,
                "unit_price": unit_price,
                "quantity": quantity,
            }
        ],
        "payment": {"method": Payment.Method.WAVE},
    }


def _attempt_event(
    *,
    event_id,
    entity_id,
    terminal_id,
    cash_session_id,
    cashier_id,
    product_id,
    product_name,
    unit_price,
    quantity,
    start_barrier: Barrier,
) -> str:
    close_old_connections()
    try:
        cashier = User.objects.get(pk=cashier_id)
        cash_session = CashSession.objects.get(pk=cash_session_id)
        start_barrier.wait(timeout=10)
        outcome = process_sale_completed_event(
            event_id=event_id,
            terminal_id=terminal_id,
            entity_id=entity_id,
            occurred_at=timezone.now(),
            payload=_payload(
                cash_session_id=cash_session.id,
                product_id=product_id,
                product_name=product_name,
                unit_price=unit_price,
                quantity=quantity,
            ),
            cashier=cashier,
        )
        return outcome.status
    finally:
        connections["default"].close()


@pytest.mark.django_db(transaction=True)
def test_replaying_the_same_event_concurrently_creates_a_single_sale() -> None:
    """Deux requêtes réseau concurrentes portant le même event_id (retry qui
    croise la première réponse en vol) ne doivent jamais produire deux ventes.
    """
    assert connection.vendor == "postgresql"

    store = Store.objects.create(name="Supérette Test")
    product = Product.objects.create(name="Coca 50cl", selling_price=Decimal("500.00"))
    Stock.objects.create(store=store, product=product, quantity=20)
    cashier = User.objects.create_user(username="cashier-a")
    register = CashRegister.objects.create(store=store, name="Caisse A")
    cash_session = CashSession.objects.create(
        cash_register=register,
        cashier=cashier,
        opening_balance=Decimal("15000.00"),
    )

    event_id = uuid4()
    sale_id = uuid4()
    start_barrier = Barrier(2)

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [
            executor.submit(
                _attempt_event,
                event_id=event_id,
                entity_id=sale_id,
                terminal_id=uuid4(),
                cash_session_id=cash_session.id,
                cashier_id=cashier.pk,
                product_id=product.id,
                product_name=product.name,
                unit_price=Decimal("500.00"),
                quantity=2,
                start_barrier=start_barrier,
            )
            for _ in range(2)
        ]
        results = [future.result(timeout=15) for future in futures]

    assert sorted(results) == [SyncEventStatus.ALREADY_PROCESSED, SyncEventStatus.SYNCED]
    assert Sale.objects.count() == 1
    assert SaleItem.objects.count() == 1
    assert Payment.objects.count() == 1
    assert ProcessedSyncEvent.objects.count() == 1
    assert InventoryMovement.objects.filter(
        movement_type=InventoryMovement.Type.SALE
    ).count() == 1
    stock = Stock.objects.get()
    assert stock.quantity == 18


@pytest.mark.django_db(transaction=True)
def test_two_offline_registers_selling_the_same_product_never_duplicate_or_corrupt() -> None:
    """Deux caisses hors-ligne (deux terminaux, deux ventes distinctes) qui
    ont chacune vendu 2 unités d'un stock serveur de 2 : les deux ventes
    doivent être acceptées à la synchronisation (la vente a déjà eu lieu
    physiquement), sans dupliquer ni corrompre les enregistrements — le
    stock diverge intentionnellement (cf. décision produit Phase F).
    """
    assert connection.vendor == "postgresql"

    store = Store.objects.create(name="Supérette Test")
    product = Product.objects.create(name="Coca 50cl", selling_price=Decimal("500.00"))
    Stock.objects.create(store=store, product=product, quantity=2)

    cashier_a = User.objects.create_user(username="cashier-a")
    cashier_b = User.objects.create_user(username="cashier-b")
    register_a = CashRegister.objects.create(store=store, name="Caisse A")
    register_b = CashRegister.objects.create(store=store, name="Caisse B")
    session_a = CashSession.objects.create(
        cash_register=register_a, cashier=cashier_a, opening_balance=Decimal("15000.00")
    )
    session_b = CashSession.objects.create(
        cash_register=register_b, cashier=cashier_b, opening_balance=Decimal("15000.00")
    )

    start_barrier = Barrier(2)
    terminals = [
        {
            "event_id": uuid4(),
            "entity_id": uuid4(),
            "terminal_id": uuid4(),
            "cash_session_id": session_a.id,
            "cashier_id": cashier_a.pk,
        },
        {
            "event_id": uuid4(),
            "entity_id": uuid4(),
            "terminal_id": uuid4(),
            "cash_session_id": session_b.id,
            "cashier_id": cashier_b.pk,
        },
    ]

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [
            executor.submit(
                _attempt_event,
                event_id=terminal["event_id"],
                entity_id=terminal["entity_id"],
                terminal_id=terminal["terminal_id"],
                cash_session_id=terminal["cash_session_id"],
                cashier_id=terminal["cashier_id"],
                product_id=product.id,
                product_name=product.name,
                unit_price=Decimal("500.00"),
                quantity=2,
                start_barrier=start_barrier,
            )
            for terminal in terminals
        ]
        results = [future.result(timeout=15) for future in futures]

    assert results == [SyncEventStatus.SYNCED, SyncEventStatus.SYNCED]
    assert Sale.objects.count() == 2
    assert SaleItem.objects.count() == 2
    assert Payment.objects.count() == 2
    assert ProcessedSyncEvent.objects.count() == 2
    assert InventoryMovement.objects.filter(
        movement_type=InventoryMovement.Type.SALE
    ).count() == 2
    stock = Stock.objects.get()
    assert stock.quantity == -2
    # select_for_update() sérialise les deux ventes sur la même ligne de stock :
    # la première consomme exactement le stock disponible (2 -> 0, pas de
    # divergence), la seconde le fait passer sous zéro (0 -> -2, divergence).
    assert ProcessedSyncEvent.objects.filter(stock_discrepancy=True).count() == 1
    assert ProcessedSyncEvent.objects.filter(stock_discrepancy=False).count() == 1
