from dataclasses import dataclass
from datetime import datetime
from typing import Any
from uuid import UUID

from django.db import IntegrityError, transaction

from apps.cash.exceptions import CashSessionClosed
from apps.cash.models import CashSession
from apps.sales.exceptions import (
    InvalidPayment,
    InvalidSaleItems,
    ProductNotFound,
)
from apps.sales.models import Sale
from apps.sales.services import complete_offline_sale

from .models import ProcessedSyncEvent


class SyncEventStatus:
    SYNCED = "SYNCED"
    ALREADY_PROCESSED = "ALREADY_PROCESSED"
    CONFLICT = "CONFLICT"
    REJECTED = "REJECTED"


@dataclass
class EventOutcome:
    event_id: UUID
    status: str
    entity_id: UUID | None = None
    code: str | None = None
    message: str | None = None


def process_sale_completed_event(
    *,
    event_id: UUID,
    terminal_id: UUID,
    entity_id: UUID,
    occurred_at: datetime,
    payload: dict[str, Any],
    cashier,
) -> EventOutcome:
    """Traite un événement `SALE_COMPLETED` de manière idempotente.

    Invariant central : soit la `Sale` ET son `ProcessedSyncEvent` sont
    committés ensemble (même transaction), soit rien ne l'est. Un retry sur
    le même `event_id` — qu'il arrive avant que le premier essai n'ait
    committé (course) ou après (event déjà marqué traité) — ne crée donc
    jamais de deuxième vente : voir le court-circuit `ALREADY_PROCESSED`
    ci-dessous, puis la défense en profondeur sur `IntegrityError` (PK
    `event_id` et PK `Sale.id` toutes deux uniques en base).
    """
    existing = ProcessedSyncEvent.objects.filter(pk=event_id).first()
    if existing is not None:
        return EventOutcome(
            event_id=event_id,
            status=SyncEventStatus.ALREADY_PROCESSED,
            entity_id=existing.entity_id,
        )

    try:
        cash_session = CashSession.objects.select_related("cash_register").get(
            pk=payload["cash_session_id"]
        )
    except CashSession.DoesNotExist:
        return EventOutcome(
            event_id=event_id,
            status=SyncEventStatus.REJECTED,
            code="CASH_SESSION_NOT_FOUND",
            message="La session de caisse indiquée n'existe pas.",
        )

    if cash_session.cashier_id != cashier.pk:
        return EventOutcome(
            event_id=event_id,
            status=SyncEventStatus.REJECTED,
            code="CASH_SESSION_NOT_OWNED",
            message="Cette session appartient à un autre caissier.",
        )

    try:
        with transaction.atomic():
            sale, stock_discrepancy = complete_offline_sale(
                sale_id=entity_id,
                cash_session=cash_session,
                items=payload["items"],
                payment_method=payload["payment"]["method"],
                received_amount=payload["payment"].get("received_amount"),
                occurred_at=occurred_at,
            )
            ProcessedSyncEvent.objects.create(
                event_id=event_id,
                terminal_id=terminal_id,
                event_type=ProcessedSyncEvent.EventType.SALE_COMPLETED,
                entity_id=sale.id,
                stock_discrepancy=stock_discrepancy,
            )
    except IntegrityError:
        winner = ProcessedSyncEvent.objects.filter(pk=event_id).first()
        if winner is not None:
            return EventOutcome(
                event_id=event_id,
                status=SyncEventStatus.ALREADY_PROCESSED,
                entity_id=winner.entity_id,
            )
        if Sale.objects.filter(pk=entity_id).exists():
            # Un event_id différent a déjà produit cette même Sale (même
            # sale_id rejoué sous un autre event_id) : jamais de doublon,
            # mais on ne peut pas prétendre avoir traité CET event_id.
            return EventOutcome(
                event_id=event_id,
                status=SyncEventStatus.ALREADY_PROCESSED,
                entity_id=entity_id,
            )
        raise
    except CashSessionClosed as exc:
        return EventOutcome(
            event_id=event_id,
            status=SyncEventStatus.CONFLICT,
            code="CASH_SESSION_CLOSED",
            message=str(exc),
        )
    except ProductNotFound as exc:
        return EventOutcome(
            event_id=event_id,
            status=SyncEventStatus.REJECTED,
            code="PRODUCT_NOT_FOUND",
            message=str(exc),
        )
    except (InvalidPayment, InvalidSaleItems) as exc:
        return EventOutcome(
            event_id=event_id,
            status=SyncEventStatus.REJECTED,
            code="INVALID_SALE",
            message=str(exc),
        )

    return EventOutcome(
        event_id=event_id, status=SyncEventStatus.SYNCED, entity_id=sale.id
    )
