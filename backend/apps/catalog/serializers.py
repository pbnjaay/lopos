from decimal import Decimal

from rest_framework import serializers

from .models import Product


class ProductSerializer(serializers.ModelSerializer):
    selling_price = serializers.DecimalField(
        max_digits=14,
        decimal_places=2,
        min_value=Decimal("0"),
    )
    purchase_price = serializers.DecimalField(
        max_digits=14,
        decimal_places=2,
        min_value=Decimal("0"),
        allow_null=True,
        required=False,
    )
    stock = serializers.IntegerField(source="current_stock", read_only=True)

    class Meta:
        model = Product
        fields = (
            "id",
            "name",
            "barcode",
            "selling_price",
            "purchase_price",
            "is_active",
            "stock",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "created_at", "updated_at")

    def validate_barcode(self, value: str | None) -> str | None:
        if value == "":
            return None
        if value is None:
            return None
        if Product.objects.filter(barcode=value).exists():
            raise serializers.ValidationError("Ce code-barres est déjà utilisé.")
        return value

    def to_representation(self, instance):
        representation = super().to_representation(instance)
        if not hasattr(instance, "current_stock"):
            representation.pop("stock", None)
        return representation
