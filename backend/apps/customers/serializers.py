from decimal import Decimal

from rest_framework import serializers

from apps.cash.models import CashSession
from apps.sales.models import Payment

from .models import Customer, CustomerPayment


class CustomerBriefSerializer(serializers.ModelSerializer):
    class Meta:
        model = Customer
        fields = ("id", "name", "phone")


class CustomerBookQuerySerializer(serializers.Serializer):
    store_id = serializers.UUIDField()


class CustomerSerializer(serializers.ModelSerializer):
    """Client avec son solde, tel que le POS le met en cache (snapshot)."""

    store_id = serializers.UUIDField(read_only=True)
    balance = serializers.DecimalField(max_digits=14, decimal_places=2, read_only=True)
    last_activity_at = serializers.DateTimeField(read_only=True, allow_null=True)

    class Meta:
        model = Customer
        fields = (
            "id",
            "store_id",
            "name",
            "phone",
            "is_active",
            "balance",
            "last_activity_at",
            "updated_at",
        )


class CreateCustomerSerializer(serializers.Serializer):
    store_id = serializers.UUIDField()
    name = serializers.CharField(max_length=255)
    # Obligatoire depuis la caisse : seule clé de déduplication fiable, et le
    # moyen de relancer le client (le modèle, lui, l'accepte vide pour les
    # reprises et l'admin).
    phone = serializers.CharField(max_length=32)


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
