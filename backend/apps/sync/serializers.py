from decimal import Decimal

from rest_framework import serializers

from apps.sales.models import Payment

from .models import ProcessedSyncEvent

MAX_BATCH_SIZE = 50
MAX_PULL_PAGE_SIZE = 1000


class SyncOfflineItemSerializer(serializers.Serializer):
    product_id = serializers.UUIDField()
    product_name = serializers.CharField(max_length=255)
    unit_price = serializers.DecimalField(
        max_digits=14, decimal_places=2, min_value=Decimal("0")
    )
    catalog_unit_price = serializers.DecimalField(
        max_digits=14, decimal_places=2, min_value=Decimal("0.01"), required=False
    )
    quantity = serializers.DecimalField(
        max_digits=12, decimal_places=3, min_value=Decimal("0.001")
    )


class SyncPaymentSerializer(serializers.Serializer):
    method = serializers.ChoiceField(choices=Payment.Method.choices)
    received_amount = serializers.DecimalField(
        max_digits=14,
        decimal_places=2,
        min_value=Decimal("0"),
        required=False,
        allow_null=True,
    )


class SyncSalePayloadSerializer(serializers.Serializer):
    cash_session_id = serializers.UUIDField()
    items = SyncOfflineItemSerializer(many=True, allow_empty=False)
    payment = SyncPaymentSerializer()


class SyncEventSerializer(serializers.Serializer):
    event_id = serializers.UUIDField()
    type = serializers.ChoiceField(choices=[ProcessedSyncEvent.EventType.SALE_COMPLETED])
    entity_id = serializers.UUIDField()
    occurred_at = serializers.DateTimeField()
    payload = SyncSalePayloadSerializer()


class SyncPushRequestSerializer(serializers.Serializer):
    terminal_id = serializers.UUIDField()
    events = SyncEventSerializer(many=True, allow_empty=False)

    def validate_events(self, value):
        if len(value) > MAX_BATCH_SIZE:
            raise serializers.ValidationError(
                f"Un batch de synchronisation ne peut pas dépasser {MAX_BATCH_SIZE} "
                "événements."
            )
        return value


class SyncPullQuerySerializer(serializers.Serializer):
    cursor = serializers.DateTimeField(required=False, allow_null=True, default=None)
