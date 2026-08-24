from decimal import Decimal

from rest_framework import serializers

from apps.cash.models import CashSession

from .models import Payment, Sale, SaleItem, SaleReturn, SaleReturnItem


class SaleItemInputSerializer(serializers.Serializer):
    product_id = serializers.UUIDField()
    quantity = serializers.DecimalField(max_digits=12, decimal_places=3, min_value=Decimal("0.001"))
    unit_price = serializers.DecimalField(
        max_digits=14, decimal_places=2, min_value=Decimal("0.01"), required=False
    )


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


class SaleListQuerySerializer(serializers.Serializer):
    cash_session_id = serializers.UUIDField(required=False)
    search = serializers.CharField(required=False, allow_blank=True, max_length=100)
    date_from = serializers.DateField(required=False)
    date_to = serializers.DateField(required=False)
    cash_register_id = serializers.UUIDField(required=False)
    cashier_id = serializers.IntegerField(required=False, min_value=1)
    payment_method = serializers.ChoiceField(choices=Payment.Method.choices, required=False)


class SaleItemSerializer(serializers.ModelSerializer):
    product_id = serializers.UUIDField(read_only=True)
    quantity_returned = serializers.DecimalField(max_digits=12, decimal_places=3, read_only=True)
    quantity_returnable = serializers.DecimalField(max_digits=12, decimal_places=3, read_only=True)

    class Meta:
        model = SaleItem
        fields = (
            "id",
            "product_id",
            "product_name",
            "sale_unit",
            "catalog_unit_price",
            "unit_price",
            "quantity",
            "line_total",
            "quantity_returned",
            "quantity_returnable",
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
    returned_total = serializers.SerializerMethodField()
    net_total = serializers.SerializerMethodField()

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
            "returned_total",
            "net_total",
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

    def get_returned_total(self, sale: Sale) -> Decimal:
        return sum((item.total_refund for item in sale.returns.all() if item.status == SaleReturn.Status.COMPLETED), Decimal("0.00"))

    def get_net_total(self, sale: Sale) -> Decimal:
        return sale.total - self.get_returned_total(sale)


class SaleSummarySerializer(SaleSerializer):
    created_at = serializers.DateTimeField(source="occurred_at", read_only=True)

    class Meta(SaleSerializer.Meta):
        fields = (
            "id",
            "created_at",
            "store",
            "cash_register",
            "cashier",
            "status",
            "total",
            "returned_total",
            "net_total",
            "payment",
        )


class SaleReturnItemInputSerializer(serializers.Serializer):
    sale_item_id = serializers.UUIDField()
    quantity = serializers.DecimalField(max_digits=12, decimal_places=3, min_value=Decimal("0.001"))
    restock = serializers.BooleanField()


class CreateSaleReturnSerializer(serializers.Serializer):
    sale_id = serializers.PrimaryKeyRelatedField(source="original_sale", queryset=Sale.objects.all())
    cash_session_id = serializers.PrimaryKeyRelatedField(source="cash_session", queryset=CashSession.objects.all())
    idempotency_key = serializers.UUIDField()
    payment_method = serializers.ChoiceField(choices=Payment.Method.choices)
    items = SaleReturnItemInputSerializer(many=True, allow_empty=False)


class SaleReturnItemSerializer(serializers.ModelSerializer):
    product_name = serializers.CharField(source="original_sale_item.product_name", read_only=True)
    sale_unit = serializers.CharField(source="original_sale_item.sale_unit", read_only=True)
    class Meta:
        model = SaleReturnItem
        fields = ("id", "product_name", "sale_unit", "quantity", "unit_price", "refund_amount", "restock")


class SaleReturnSerializer(serializers.ModelSerializer):
    items = SaleReturnItemSerializer(many=True, read_only=True)
    original_sale_id = serializers.UUIDField(read_only=True)
    cash_session_id = serializers.UUIDField(read_only=True)
    created_by = serializers.CharField(source="created_by.username", read_only=True)
    class Meta:
        model = SaleReturn
        fields = ("id", "reference", "original_sale_id", "cash_session_id", "created_by", "total_refund", "payment_method", "status", "created_at", "items")
