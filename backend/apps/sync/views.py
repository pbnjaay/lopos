import logging

from rest_framework.response import Response
from rest_framework.views import APIView

from .models import ProcessedSyncEvent
from .serializers import SyncPullQuerySerializer, SyncPushRequestSerializer
from .services import EventOutcome, process_sale_completed_event, pull_catalog_changes

logger = logging.getLogger("apps.sync")


def _serialize_outcome(outcome: EventOutcome) -> dict:
    result = {"event_id": str(outcome.event_id), "status": outcome.status}
    if outcome.entity_id is not None:
        result["entity_id"] = str(outcome.entity_id)
    if outcome.code is not None:
        result["code"] = outcome.code
    if outcome.message is not None:
        result["message"] = outcome.message
    return result


class SyncPushView(APIView):
    """Point d'entrée unique de synchronisation des événements offline.

    Traite chaque événement du batch indépendamment (pas de tout-ou-rien) :
    un événement réussi n'empêche pas les suivants d'échouer, et
    inversement. Chaque événement est idempotent — le renvoyer une, deux ou
    dix fois ne produit jamais plus d'une vente (voir
    `apps.sync.services.process_sale_completed_event`).
    """

    def post(self, request) -> Response:
        serializer = SyncPushRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        terminal_id = serializer.validated_data["terminal_id"]
        events = serializer.validated_data["events"]

        logger.info(
            "sync_batch_received",
            extra={"terminal_id": str(terminal_id), "event_count": len(events)},
        )

        results = []
        for event in events:
            if event["type"] != ProcessedSyncEvent.EventType.SALE_COMPLETED:
                results.append(
                    {
                        "event_id": str(event["event_id"]),
                        "status": "REJECTED",
                        "code": "UNKNOWN_EVENT_TYPE",
                        "message": f"Type d'événement inconnu : {event['type']}.",
                    }
                )
                continue

            outcome = process_sale_completed_event(
                event_id=event["event_id"],
                terminal_id=terminal_id,
                entity_id=event["entity_id"],
                occurred_at=event["occurred_at"],
                payload=event["payload"],
                cashier=request.user,
            )
            results.append(_serialize_outcome(outcome))

        return Response({"results": results}, status=200)


class SyncPullView(APIView):
    """Delta catalogue minimal pour rafraîchir le cache local d'un POS.

    `GET /api/v1/sync/pull/?cursor=<iso8601>` — sans `cursor`, renvoie tout
    le catalogue actif ou non (premier chargement / réinstallation).
    """

    def get(self, request) -> Response:
        query_serializer = SyncPullQuerySerializer(data=request.query_params)
        query_serializer.is_valid(raise_exception=True)
        since = query_serializer.validated_data["cursor"]

        page = pull_catalog_changes(since=since)
        return Response({"cursor": page.cursor, "changes": page.changes}, status=200)
