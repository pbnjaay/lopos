from uuid import UUID

from django.db.models import IntegerField, OuterRef, Q, Subquery, Value
from django.db.models.functions import Coalesce
from rest_framework import mixins, serializers, viewsets

from apps.inventory.models import Stock
from apps.stores.models import Store

from .models import Product
from .serializers import ProductSerializer


class ProductViewSet(
    mixins.CreateModelMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    serializer_class = ProductSerializer

    def get_queryset(self):
        queryset = Product.objects.filter(is_active=True)

        search = self.request.query_params.get("search")
        if search:
            queryset = queryset.filter(
                Q(name__icontains=search) | Q(barcode__icontains=search)
            )

        barcode = self.request.query_params.get("barcode")
        if barcode:
            queryset = queryset.filter(barcode=barcode)

        store_id = self.request.query_params.get("store_id")
        if store_id:
            try:
                parsed_store_id = UUID(store_id)
            except ValueError as exc:
                raise serializers.ValidationError(
                    {"store_id": "Identifiant de magasin invalide."}
                ) from exc
            if not Store.objects.filter(pk=parsed_store_id).exists():
                raise serializers.ValidationError(
                    {"store_id": "Ce magasin n'existe pas."}
                )
            stock_quantity = Stock.objects.filter(
                store_id=parsed_store_id,
                product_id=OuterRef("pk"),
            ).values("quantity")[:1]
            queryset = queryset.annotate(
                current_stock=Coalesce(
                    Subquery(stock_quantity),
                    Value(0),
                    output_field=IntegerField(),
                )
            )

        return queryset.order_by("name")
