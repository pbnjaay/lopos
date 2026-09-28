from decimal import Decimal

from rest_framework import serializers

from apps.cash.models import CashSession
from apps.sales.models import Payment

from .models import Customer, CustomerPayment


class CustomerBriefSerializer(serializers.ModelSerializer):
    class Meta:
        model = Customer
        fields = ("id", "name", "phone")


class CreateCustomerPaymentSerializer(serializers.Serializer):
    idempotency_key = serializers.UUIDField()
    customer_id = serializers.PrimaryKeyRelatedField(
        source="customer", queryset=Customer.objects.all()
    )
    cash_session_id = serializers.PrimaryKeyRelatedField(
        source="cash_session", queryset=CashSession.objects.all()
    )
    method = serializers.ChoiceField(choices=Payment.Method.choices)
    amount = serializers.DecimalField(max_digits=14, decimal_places=2, min_value=Decimal("0.01"))
    received_amount = serializers.DecimalField(
        max_digits=14, decimal_places=2, min_value=Decimal("0"),
        required=False, allow_null=True, default=None,
    )


class CustomerPaymentSerializer(serializers.ModelSerializer):
    customer = CustomerBriefSerializer(read_only=True)
    store = serializers.SerializerMethodField()
    cash_session_id = serializers.UUIDField(read_only=True)
    created_by = serializers.CharField(source="created_by.username", read_only=True)

    class Meta:
        model = CustomerPayment
        fields = (
            "id",
            "reference",
            "customer",
            "store",
            "cash_session_id",
            "method",
            "amount",
            "received_amount",
            "change_amount",
            "balance_before",
            "balance_after",
            "created_by",
            "created_at",
        )

    def get_store(self, payment: CustomerPayment) -> dict:
        return {"id": payment.store_id, "name": payment.store.name}
