from decimal import Decimal

from rest_framework import serializers

from .models import Product


class ProductSerializer(serializers.ModelSerializer):
    selling_price = serializers.DecimalField(
        max_digits=14,
        decimal_places=2,
        min_value=Decimal("0"),
    )
    # Écriture seule : un produit créé par l'API peut recevoir son prix
    # d'achat, mais le coût ne repart jamais vers les postes de caisse.
    purchase_price = serializers.DecimalField(
        max_digits=14,
        decimal_places=2,
        min_value=Decimal("0"),
        allow_null=True,
        required=False,
        write_only=True,
    )
    stock = serializers.DecimalField(source="current_stock", max_digits=12, decimal_places=3, read_only=True)
    low_stock_threshold = serializers.IntegerField(
        min_value=0, allow_null=True, required=False
    )

    class Meta:
        model = Product
        fields = (
            "id",
            "name",
            "barcode",
            "selling_price",
            "purchase_price",
            "sale_unit",
            "low_stock_threshold",
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
        # Seul le catalogue du commerce compte : dire qu'un code est pris
        # ailleurs révélerait le catalogue d'un autre commerce.
        organization = self.context["organization"]
        if Product.objects.filter(organization=organization, barcode=value).exists():
            raise serializers.ValidationError("Ce code-barres est déjà utilisé.")
        return value

    def to_representation(self, instance):
        representation = super().to_representation(instance)
        if not hasattr(instance, "current_stock"):
            representation.pop("stock", None)
        return representation
