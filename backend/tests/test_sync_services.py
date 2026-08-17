from datetime import timedelta
from decimal import Decimal
from uuid import uuid4

import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone

from apps.cash.models import CashSession
from apps.catalog.models import Product
from apps.inventory.models import InventoryMovement, Stock
from apps.sales.models import Payment, Sale, SaleItem
from apps.stores.models import CashRegister, Store
from apps.sync.models import ProcessedSyncEvent
from apps.sync.services import SyncEventStatus, process_sale_completed_event

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
    register = CashRegister.objects.create(store=store, name="Caisse 01")
    return CashSession.objects.create(
        cash_register=register,
        cashier=cashier,
        opening_balance=Decimal("15000.00"),
    )


@pytest.fixture
def product(store: Store) -> Product:
    product = Product.objects.create(name="Coca 50cl", selling_price=Decimal("600.00"))
    Stock.objects.create(store=store, product=product, quantity=20)
    return product


def _sale_event_payload(*, cash_session: CashSession, product: Product, unit_price: Decimal):
    return {
        "cash_session_id": cash_session.id,
        "items": [
            {
                "product_id": product.id,
                "product_name": product.name,
                "unit_price": unit_price,
                "quantity": 2,
            }
        ],
        "payment": {"method": Payment.Method.CASH, "received_amount": Decimal("2000.00")},
    }


def test_sale_completed_event_creates_sale_once(
    cash_session: CashSession, product: Product, cashier
) -> None:
    event_id = uuid4()
    sale_id = uuid4()
    occurred_at = timezone.now() - timedelta(hours=2)

    outcome = process_sale_completed_event(
        event_id=event_id,
        terminal_id=uuid4(),
        entity_id=sale_id,
        occurred_at=occurred_at,
        payload=_sale_event_payload(
            cash_session=cash_session, product=product, unit_price=Decimal("500.00")
        ),
        cashier=cashier,
    )

    assert outcome.status == SyncEventStatus.SYNCED
    assert outcome.entity_id == sale_id
    assert Sale.objects.count() == 1
    sale = Sale.objects.get(pk=sale_id)
    assert sale.occurred_at == occurred_at
    assert SaleItem.objects.count() == 1
    assert Payment.objects.count() == 1
    assert InventoryMovement.objects.filter(
        movement_type=InventoryMovement.Type.SALE
    ).count() == 1
    assert ProcessedSyncEvent.objects.filter(pk=event_id).exists()


def test_offline_price_snapshot_is_trusted_over_current_catalog_price(
    cash_session: CashSession, product: Product, cashier
) -> None:
    # Le prix catalogue actuel est 600, mais la vente offline a été
    # capturée quand le prix local était encore 500 : le backend doit
    # respecter ce snapshot, pas recalculer depuis Product.selling_price.
    outcome = process_sale_completed_event(
        event_id=uuid4(),
        terminal_id=uuid4(),
        entity_id=uuid4(),
        occurred_at=timezone.now(),
        payload=_sale_event_payload(
            cash_session=cash_session, product=product, unit_price=Decimal("500.00")
        ),
        cashier=cashier,
    )

    assert outcome.status == SyncEventStatus.SYNCED
    item = SaleItem.objects.get(sale_id=outcome.entity_id)
    assert item.unit_price == Decimal("500.00")
    assert item.line_total == Decimal("1000.00")
    assert item.sale.total == Decimal("1000.00")


def test_duplicate_event_id_is_reported_as_already_processed(
    cash_session: CashSession, product: Product, cashier
) -> None:
    event_id = uuid4()
    payload = _sale_event_payload(
        cash_session=cash_session, product=product, unit_price=Decimal("500.00")
    )

    first = process_sale_completed_event(
        event_id=event_id,
        terminal_id=uuid4(),
        entity_id=uuid4(),
        occurred_at=timezone.now(),
        payload=payload,
        cashier=cashier,
    )
    second = process_sale_completed_event(
        event_id=event_id,
        terminal_id=uuid4(),
        entity_id=uuid4(),  # même si le client renvoyait un entity_id différent
        occurred_at=timezone.now(),
        payload=payload,
        cashier=cashier,
    )

    assert first.status == SyncEventStatus.SYNCED
    assert second.status == SyncEventStatus.ALREADY_PROCESSED
    assert second.entity_id == first.entity_id
    assert Sale.objects.count() == 1
    assert SaleItem.objects.count() == 1
    assert Payment.objects.count() == 1
    assert InventoryMovement.objects.filter(
        movement_type=InventoryMovement.Type.SALE
    ).count() == 1


def test_same_sale_id_under_different_event_id_never_duplicates(
    cash_session: CashSession, product: Product, cashier
) -> None:
    sale_id = uuid4()
    payload = _sale_event_payload(
        cash_session=cash_session, product=product, unit_price=Decimal("500.00")
    )

    first = process_sale_completed_event(
        event_id=uuid4(),
        terminal_id=uuid4(),
        entity_id=sale_id,
        occurred_at=timezone.now(),
        payload=payload,
        cashier=cashier,
    )
    # Bug client hypothétique : même sale_id (id définitif de la vente),
    # mais un nouvel event_id (par ex. régénéré par erreur au retry).
    second = process_sale_completed_event(
        event_id=uuid4(),
        terminal_id=uuid4(),
        entity_id=sale_id,
        occurred_at=timezone.now(),
        payload=payload,
        cashier=cashier,
    )

    assert first.status == SyncEventStatus.SYNCED
    assert second.status == SyncEventStatus.ALREADY_PROCESSED
    assert Sale.objects.count() == 1
    assert SaleItem.objects.count() == 1
    assert Payment.objects.count() == 1


def test_offline_sale_accepted_even_when_stock_goes_negative(
    cash_session: CashSession, store: Store, cashier
) -> None:
    product = Product.objects.create(name="Pain", selling_price=Decimal("300.00"))
    stock = Stock.objects.create(store=store, product=product, quantity=1)

    outcome = process_sale_completed_event(
        event_id=uuid4(),
        terminal_id=uuid4(),
        entity_id=uuid4(),
        occurred_at=timezone.now(),
        payload={
            "cash_session_id": cash_session.id,
            "items": [
                {
                    "product_id": product.id,
                    "product_name": product.name,
                    "unit_price": Decimal("300.00"),
                    "quantity": 3,
                }
            ],
            "payment": {"method": Payment.Method.WAVE},
        },
        cashier=cashier,
    )

    assert outcome.status == SyncEventStatus.SYNCED
    stock.refresh_from_db()
    assert stock.quantity == -2
    event = ProcessedSyncEvent.objects.get(pk=outcome.event_id)
    assert event.stock_discrepancy is True


def test_offline_sale_rejects_after_online_sale_closed_stock_normally(
    cash_session: CashSession, product: Product, cashier
) -> None:
    # Cas de contrôle : quand le stock suffit, aucune divergence n'est
    # marquée.
    outcome = process_sale_completed_event(
        event_id=uuid4(),
        terminal_id=uuid4(),
        entity_id=uuid4(),
        occurred_at=timezone.now(),
        payload=_sale_event_payload(
            cash_session=cash_session, product=product, unit_price=Decimal("500.00")
        ),
        cashier=cashier,
    )
    assert outcome.status == SyncEventStatus.SYNCED
    event = ProcessedSyncEvent.objects.get(pk=outcome.event_id)
    assert event.stock_discrepancy is False


def test_offline_sale_conflicts_when_session_closed_before_the_sale(
    cash_session: CashSession, product: Product, cashier
) -> None:
    closed_at = timezone.now() - timedelta(hours=1)
    cash_session.status = CashSession.Status.CLOSED
    cash_session.closed_at = closed_at
    cash_session.closing_balance = Decimal("15000.00")
    cash_session.expected_balance = Decimal("15000.00")
    cash_session.difference = Decimal("0.00")
    cash_session.save()

    outcome = process_sale_completed_event(
        event_id=uuid4(),
        terminal_id=uuid4(),
        entity_id=uuid4(),
        occurred_at=closed_at + timedelta(minutes=5),  # vente après la clôture
        payload=_sale_event_payload(
            cash_session=cash_session, product=product, unit_price=Decimal("500.00")
        ),
        cashier=cashier,
    )

    assert outcome.status == SyncEventStatus.CONFLICT
    assert outcome.code == "CASH_SESSION_CLOSED"
    assert Sale.objects.count() == 0
    assert not ProcessedSyncEvent.objects.exists()


def test_offline_sale_accepted_when_occurred_before_session_closed(
    cash_session: CashSession, product: Product, cashier
) -> None:
    closed_at = timezone.now() - timedelta(hours=1)
    cash_session.status = CashSession.Status.CLOSED
    cash_session.closed_at = closed_at
    cash_session.closing_balance = Decimal("15000.00")
    cash_session.expected_balance = Decimal("15000.00")
    cash_session.difference = Decimal("0.00")
    cash_session.save()

    outcome = process_sale_completed_event(
        event_id=uuid4(),
        terminal_id=uuid4(),
        entity_id=uuid4(),
        occurred_at=closed_at - timedelta(minutes=5),  # vente avant la clôture
        payload=_sale_event_payload(
            cash_session=cash_session, product=product, unit_price=Decimal("500.00")
        ),
        cashier=cashier,
    )

    assert outcome.status == SyncEventStatus.SYNCED
    assert Sale.objects.get(pk=outcome.entity_id).cash_session_id == cash_session.id


def test_offline_sale_rejected_when_product_no_longer_exists(
    cash_session: CashSession, cashier
) -> None:
    ghost_product_id = uuid4()
    outcome = process_sale_completed_event(
        event_id=uuid4(),
        terminal_id=uuid4(),
        entity_id=uuid4(),
        occurred_at=timezone.now(),
        payload={
            "cash_session_id": cash_session.id,
            "items": [
                {
                    "product_id": ghost_product_id,
                    "product_name": "Produit supprimé",
                    "unit_price": Decimal("100.00"),
                    "quantity": 1,
                }
            ],
            "payment": {"method": Payment.Method.WAVE},
        },
        cashier=cashier,
    )

    assert outcome.status == SyncEventStatus.REJECTED
    assert outcome.code == "PRODUCT_NOT_FOUND"
    assert Sale.objects.count() == 0


def test_offline_sale_accepted_for_deactivated_but_existing_product(
    cash_session: CashSession, product: Product, cashier
) -> None:
    product.is_active = False
    product.save(update_fields=["is_active"])

    outcome = process_sale_completed_event(
        event_id=uuid4(),
        terminal_id=uuid4(),
        entity_id=uuid4(),
        occurred_at=timezone.now(),
        payload=_sale_event_payload(
            cash_session=cash_session, product=product, unit_price=Decimal("500.00")
        ),
        cashier=cashier,
    )

    assert outcome.status == SyncEventStatus.SYNCED


def test_offline_sale_rejected_when_cash_session_not_owned_by_cashier(
    cash_session: CashSession, product: Product
) -> None:
    other_cashier = User.objects.create_user(username="other-cashier")

    outcome = process_sale_completed_event(
        event_id=uuid4(),
        terminal_id=uuid4(),
        entity_id=uuid4(),
        occurred_at=timezone.now(),
        payload=_sale_event_payload(
            cash_session=cash_session, product=product, unit_price=Decimal("500.00")
        ),
        cashier=other_cashier,
    )

    assert outcome.status == SyncEventStatus.REJECTED
    assert outcome.code == "CASH_SESSION_NOT_OWNED"
    assert Sale.objects.count() == 0


def test_sale_keeps_its_original_session_even_if_a_new_one_opens_later(
    cash_session: CashSession, product: Product, cashier, store: Store
) -> None:
    outcome = process_sale_completed_event(
        event_id=uuid4(),
        terminal_id=uuid4(),
        entity_id=uuid4(),
        occurred_at=timezone.now() - timedelta(hours=3),
        payload=_sale_event_payload(
            cash_session=cash_session, product=product, unit_price=Decimal("500.00")
        ),
        cashier=cashier,
    )
    assert outcome.status == SyncEventStatus.SYNCED

    # Une nouvelle session s'ouvre sur une autre caisse entre-temps.
    other_register = CashRegister.objects.create(store=store, name="Caisse 02")
    CashSession.objects.create(
        cash_register=other_register,
        cashier=cashier,
        opening_balance=Decimal("10000.00"),
    )

    sale = Sale.objects.get(pk=outcome.entity_id)
    assert sale.cash_session_id == cash_session.id
