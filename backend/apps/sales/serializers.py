from decimal import Decimal

from rest_framework import serializers

from apps.cash.models import CashSession

from .models import Payment, Sale, SaleItem


class SaleItemInputSerializer(serializers.Serializer):
    product_id = serializers.UUIDField()
    quantity = serializers.IntegerField(min_value=1)


class PaymentInputSerializer(serializers.Serializer):
    method = serializers.ChoiceField(choices=Payment.Method.choices)
    received_amount = serializers.DecimalField(
        max_digits=14,
        decimal_places=2,
        min_value=Decimal("0"),
        required=False,
        allow_null=True,
    )


class CompleteSaleSerializer(serializers.Serializer):
    cash_session_id = serializers.PrimaryKeyRelatedField(
        source="cash_session",
        queryset=CashSession.objects.all(),
    )
    items = SaleItemInputSerializer(many=True, allow_empty=False)
    payment = PaymentInputSerializer()


class SaleItemSerializer(serializers.ModelSerializer):
    product_id = serializers.UUIDField(read_only=True)

    class Meta:
        model = SaleItem
        fields = (
            "product_id",
            "product_name",
            "unit_price",
            "quantity",
            "line_total",
        )


class PaymentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Payment
        fields = ("method", "amount", "received_amount", "change_amount")


class SaleSerializer(serializers.ModelSerializer):
    items = SaleItemSerializer(many=True, read_only=True)
    payment = PaymentSerializer(read_only=True)
    store = serializers.SerializerMethodField()
    cash_register = serializers.SerializerMethodField()
    cashier = serializers.SerializerMethodField()

    class Meta:
        model = Sale
        fields = (
            "id",
            "created_at",
            "store",
            "cash_register",
            "cashier",
            "status",
            "subtotal",
            "discount",
            "total",
            "payment",
            "items",
        )

    def get_store(self, sale: Sale) -> dict:
        store = sale.cash_session.cash_register.store
        return {"id": store.id, "name": store.name}

    def get_cash_register(self, sale: Sale) -> dict:
        register = sale.cash_session.cash_register
        return {"id": register.id, "name": register.name}

    def get_cashier(self, sale: Sale) -> dict:
        return {"id": sale.cashier_id, "username": sale.cashier.username}
