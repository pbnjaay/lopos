import logging
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.cash.exceptions import CashSessionClosed
from apps.cash.models import CashSession
from apps.catalog.models import Product
from apps.observability.sentry_context import tag_sync_scope
from apps.sales.exceptions import (
    CustomerNotFound,
    InvalidPayment,
    InvalidSaleItems,
    ProductNotFound,
)
from apps.sales.models import Sale
from apps.sales.services import complete_offline_sale
from apps.stores.access import user_can_access_store

from .models import ProcessedSyncEvent

logger = logging.getLogger("apps.sync")


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

    `cashier` est l'utilisateur connecté qui transmet l'événement — pas
    forcément le caissier de la vente (caisse partagée) : il doit seulement
    avoir accès à la boutique de la session.

    Invariant central : soit la `Sale` ET son `ProcessedSyncEvent` sont
    committés ensemble (même transaction), soit rien ne l'est. Un retry sur
    le même `event_id` — qu'il arrive avant que le premier essai n'ait
    committé (course) ou après (event déjà marqué traité) — ne crée donc
    jamais de deuxième vente : voir le court-circuit `ALREADY_PROCESSED`
    ci-dessous, puis la défense en profondeur sur `IntegrityError` (PK
    `event_id` et PK `Sale.id` toutes deux uniques en base).
    """
    log_context = {
        "event_id": str(event_id),
        "terminal_id": str(terminal_id),
        "entity_id": str(entity_id),
        "cashier_id": cashier.pk,
    }

    tag_sync_scope(sync_event_id=event_id)

    existing = ProcessedSyncEvent.objects.filter(pk=event_id).first()
    if existing is not None:
        logger.info("sync_event_duplicate", extra=log_context)
        return EventOutcome(
            event_id=event_id,
            status=SyncEventStatus.ALREADY_PROCESSED,
            entity_id=existing.entity_id,
        )

    try:
        cash_session = CashSession.objects.select_related("cash_register__store").get(
            pk=payload["cash_session_id"]
        )
    except CashSession.DoesNotExist:
        logger.warning(
            "sync_event_rejected", extra={**log_context, "code": "CASH_SESSION_NOT_FOUND"}
        )
        return EventOutcome(
            event_id=event_id,
            status=SyncEventStatus.REJECTED,
            code="CASH_SESSION_NOT_FOUND",
            message="La session de caisse indiquée n'existe pas.",
        )

    # Sur une caisse partagée, les ventes d'un caissier peuvent rester en
    # attente après sa déconnexion et partir avec la connexion du collègue
    # suivant. On accepte donc tout utilisateur ayant accès à la boutique de
    # la session — et toujours le caissier de la session lui-même, même
    # retiré de la boutique depuis : ses ventes ont bien eu lieu. La vente
    # reste celle de la session (son caissier, son rapport Z), et
    # `pushed_by` garde la trace de qui l'a transmise.
    is_session_cashier = cash_session.cashier_id == cashier.pk
    if not is_session_cashier and not user_can_access_store(
        cashier, cash_session.cash_register.store
    ):
        logger.warning(
            "sync_event_rejected", extra={**log_context, "code": "STORE_NOT_ALLOWED"}
        )
        return EventOutcome(
            event_id=event_id,
            status=SyncEventStatus.REJECTED,
            code="STORE_NOT_ALLOWED",
            message="Vous n’avez pas accès à la boutique de cette vente.",
        )
    if not is_session_cashier:
        logger.info(
            "sync_event_pushed_by_colleague",
            extra={**log_context, "session_cashier_id": cash_session.cashier_id},
        )

    try:
        with transaction.atomic():
            sale, stock_discrepancy = complete_offline_sale(
                sale_id=entity_id,
                cash_session=cash_session,
                items=payload["items"],
                payments=payload["payments"],
                occurred_at=occurred_at,
                customer_id=payload.get("customer_id"),
                credit_amount=payload.get("credit_amount", Decimal("0.00")),
            )
            ProcessedSyncEvent.objects.create(
                event_id=event_id,
                terminal_id=terminal_id,
                event_type=ProcessedSyncEvent.EventType.SALE_COMPLETED,
                entity_id=sale.id,
                store_id=cash_session.cash_register.store_id,
                pushed_by=cashier,
                stock_discrepancy=stock_discrepancy,
            )
    except IntegrityError:
        winner = ProcessedSyncEvent.objects.filter(pk=event_id).first()
        if winner is not None:
            logger.info("sync_event_duplicate_race", extra=log_context)
            return EventOutcome(
                event_id=event_id,
                status=SyncEventStatus.ALREADY_PROCESSED,
                entity_id=winner.entity_id,
            )
        if Sale.objects.filter(pk=entity_id).exists():
            # Un event_id différent a déjà produit cette même Sale (même
            # sale_id rejoué sous un autre event_id) : jamais de doublon,
            # mais on ne peut pas prétendre avoir traité CET event_id.
            logger.info("sync_event_sale_id_reused", extra=log_context)
            return EventOutcome(
                event_id=event_id,
                status=SyncEventStatus.ALREADY_PROCESSED,
                entity_id=entity_id,
            )
        logger.exception("sync_event_integrity_error", extra=log_context)
        raise
    except CashSessionClosed as exc:
        logger.info(
            "sync_event_conflict",
            extra={**log_context, "code": "CASH_SESSION_CLOSED"},
        )
        return EventOutcome(
            event_id=event_id,
            status=SyncEventStatus.CONFLICT,
            code="CASH_SESSION_CLOSED",
            message=str(exc),
        )
    except ProductNotFound as exc:
        logger.warning(
            "sync_event_rejected", extra={**log_context, "code": "PRODUCT_NOT_FOUND"}
        )
        return EventOutcome(
            event_id=event_id,
            status=SyncEventStatus.REJECTED,
            code="PRODUCT_NOT_FOUND",
            message=str(exc),
        )
    except CustomerNotFound as exc:
        # Le client est choisi dans le cache local du POS : absent côté
        # serveur (ou rattaché à un autre magasin), la dette ne peut pas être
        # inscrite. Rejet visible dans les ventes en conflit, jamais silencieux.
        logger.warning(
            "sync_event_rejected", extra={**log_context, "code": "CUSTOMER_NOT_FOUND"}
        )
        return EventOutcome(
            event_id=event_id,
            status=SyncEventStatus.REJECTED,
            code="CUSTOMER_NOT_FOUND",
            message=str(exc),
        )
    except (InvalidPayment, InvalidSaleItems) as exc:
        logger.warning(
            "sync_event_rejected", extra={**log_context, "code": "INVALID_SALE"}
        )
        return EventOutcome(
            event_id=event_id,
            status=SyncEventStatus.REJECTED,
            code="INVALID_SALE",
            message=str(exc),
        )

    logger.info(
        "sync_event_synced",
        extra={**log_context, "stock_discrepancy": stock_discrepancy},
    )
    return EventOutcome(
        event_id=event_id, status=SyncEventStatus.SYNCED, entity_id=sale.id
    )


PULL_PAGE_SIZE = 1000


@dataclass
class PullPage:
    cursor: str
    changes: list[dict[str, Any]]


def pull_catalog_changes(*, since: datetime | None) -> PullPage:
    """Renvoie le delta catalogue (produits) depuis `since`, minimal pour ce MVP.

    Pas de change-log dédié : `Product.updated_at` fait office de curseur.
    Un produit désactivé est renvoyé comme un PRODUCT_UPSERT normal avec
    `is_active: false` (soft delete), pas de type d'événement séparé.

    Pagination volontairement simple : si le nombre de changements dépasse
    `PULL_PAGE_SIZE`, le curseur retourné est l'`updated_at` du dernier
    élément renvoyé (le client doit rappeler l'endpoint immédiatement avec
    ce curseur pour continuer). Sinon, le curseur est l'instant capturé
    juste avant la requête, pour ne jamais rater un produit modifié pendant
    le traitement.
    """
    now = timezone.now()
    queryset = Product.objects.order_by("updated_at", "id")
    if since is not None:
        queryset = queryset.filter(updated_at__gt=since)
    products = list(queryset[:PULL_PAGE_SIZE])

    changes = [
        {
            "type": "PRODUCT_UPSERT",
            "id": str(product.id),
            "data": {
                "name": product.name,
                "barcode": product.barcode,
                "selling_price": str(product.selling_price),
                "sale_unit": product.sale_unit,
                "is_active": product.is_active,
            },
        }
        for product in products
    ]

    if len(products) == PULL_PAGE_SIZE:
        next_cursor = products[-1].updated_at.isoformat()
    else:
        next_cursor = now.isoformat()

    return PullPage(cursor=next_cursor, changes=changes)
