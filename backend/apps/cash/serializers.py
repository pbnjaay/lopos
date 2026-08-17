from decimal import Decimal

from rest_framework import serializers

from apps.stores.models import CashRegister

from .models import CashSession


class OpenCashSessionSerializer(serializers.Serializer):
    cash_register_id = serializers.PrimaryKeyRelatedField(
        source="cash_register",
        queryset=CashRegister.objects.all(),
    )
    opening_balance = serializers.DecimalField(
        max_digits=14,
        decimal_places=2,
        min_value=Decimal("0"),
    )


class CashSessionSerializer(serializers.ModelSerializer):
    cash_register_id = serializers.UUIDField(read_only=True)
    cashier_id = serializers.ReadOnlyField()

    class Meta:
        model = CashSession
        fields = (
            "id",
            "cash_register_id",
            "cashier_id",
            "opening_balance",
            "status",
            "opened_at",
            "closing_balance",
            "expected_balance",
            "difference",
            "closed_at",
        )
        read_only_fields = fields
