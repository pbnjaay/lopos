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


class CloseCashSessionSerializer(serializers.Serializer):
    counted_cash = serializers.DecimalField(
        max_digits=14,
        decimal_places=2,
    )


class _CashRegisterBriefSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    name = serializers.CharField()


class _CashierBriefSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    username = serializers.CharField()


class _PaymentTotalsSerializer(serializers.Serializer):
    cash = serializers.DecimalField(max_digits=14, decimal_places=2)
    wave = serializers.DecimalField(max_digits=14, decimal_places=2)
    orange_money = serializers.DecimalField(max_digits=14, decimal_places=2)


class CashSessionSummarySerializer(serializers.Serializer):
    id = serializers.UUIDField()
    status = serializers.CharField()
    cash_register = _CashRegisterBriefSerializer()
    cashier = _CashierBriefSerializer()
    opened_at = serializers.DateTimeField()
    sales_count = serializers.IntegerField()
    gross_sales = serializers.DecimalField(max_digits=14, decimal_places=2)
    payments = _PaymentTotalsSerializer()
    opening_balance = serializers.DecimalField(max_digits=14, decimal_places=2)
    expected_cash = serializers.DecimalField(max_digits=14, decimal_places=2)
    counted_cash = serializers.DecimalField(
        max_digits=14, decimal_places=2, allow_null=True
    )
    cash_difference = serializers.DecimalField(
        max_digits=14, decimal_places=2, allow_null=True
    )
    closed_at = serializers.DateTimeField(allow_null=True)


def summary_to_payload(summary) -> dict:
    cash_session = summary.cash_session
    return {
        "id": cash_session.id,
        "status": cash_session.status,
        "cash_register": {
            "id": cash_session.cash_register_id,
            "name": cash_session.cash_register.name,
        },
        "cashier": {
            "id": cash_session.cashier_id,
            "username": cash_session.cashier.username,
        },
        "opened_at": cash_session.opened_at,
        "sales_count": summary.sales_count,
        "gross_sales": summary.gross_sales,
        "payments": {
            "cash": summary.cash_sales,
            "wave": summary.wave_sales,
            "orange_money": summary.orange_money_sales,
        },
        "opening_balance": summary.opening_balance,
        "expected_cash": summary.expected_cash,
        "counted_cash": summary.counted_cash,
        "cash_difference": summary.cash_difference,
        "closed_at": summary.closed_at,
    }
