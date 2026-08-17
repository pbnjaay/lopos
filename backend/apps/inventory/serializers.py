from rest_framework import serializers

from apps.catalog.models import Product
from apps.stores.models import Store


class StockInSerializer(serializers.Serializer):
    store_id = serializers.PrimaryKeyRelatedField(
        source="store",
        queryset=Store.objects.all(),
    )
    product_id = serializers.PrimaryKeyRelatedField(
        source="product",
        queryset=Product.objects.all(),
    )
    quantity = serializers.IntegerField(min_value=1)


class StockInResultSerializer(serializers.Serializer):
    product_id = serializers.UUIDField()
    store_id = serializers.UUIDField()
    quantity_added = serializers.IntegerField()
    current_stock = serializers.IntegerField()
