from datetime import timedelta
from uuid import UUID

from django.db.models import DecimalField, OuterRef, Q, Subquery, Sum, Value
from django.db.models.functions import Coalesce
from django.utils import timezone
from rest_framework import mixins, serializers, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.inventory.models import Stock
from apps.sales.models import SaleItem
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
                    output_field=DecimalField(max_digits=12, decimal_places=3),
                )
            )

        return queryset.order_by("name")

    # Fenetre glissante : ce qui se vend aujourd'hui, pas ce qui se vendait
    # a l'ouverture du magasin.
    TOP_PRODUCTS_WINDOW_DAYS = 30
    TOP_PRODUCTS_DEFAULT_LIMIT = 24
    TOP_PRODUCTS_MAX_LIMIT = 60

    @action(detail=False, methods=["get"])
    def top(self, request):
        """Meilleures ventes du magasin, pour la grille du point de vente.

        Le POS ne doit jamais charger un catalogue entier : sur une superette
        de plusieurs centaines de references, la grille deviendrait illisible
        et le cache hors ligne inutilement lourd. On renvoie donc une liste
        courte, classee par quantite vendue sur la fenetre glissante, que le
        client se charge ensuite d'afficher dans un ordre stable.
        """
        store_id = request.query_params.get("store_id")
        if not store_id:
            raise serializers.ValidationError(
                {"store_id": "Ce parametre est obligatoire."}
            )

        limit = self._parse_limit(request.query_params.get("limit"))
        queryset = self.get_queryset()
        since = timezone.now() - timedelta(days=self.TOP_PRODUCTS_WINDOW_DAYS)
        ranking = (
            SaleItem.objects.filter(
                sale__cash_session__cash_register__store_id=store_id,
                sale__occurred_at__gte=since,
                product__is_active=True,
            )
            .values("product_id")
            .annotate(sold=Sum("quantity"))
            .order_by("-sold")[:limit]
        )
        ranked_ids = [row["product_id"] for row in ranking]

        products = {product.pk: product for product in queryset.filter(pk__in=ranked_ids)}
        ordered = [products[pk] for pk in ranked_ids if pk in products]

        # Un magasin qui vient d'ouvrir n'a aucun historique : plutot qu'une
        # grille vide, on complete avec le debut du catalogue.
        if len(ordered) < limit:
            already = {product.pk for product in ordered}
            for product in queryset.exclude(pk__in=already)[: limit - len(ordered)]:
                ordered.append(product)

        return Response(self.get_serializer(ordered, many=True).data)

    def _parse_limit(self, raw: str | None) -> int:
        if raw is None:
            return self.TOP_PRODUCTS_DEFAULT_LIMIT
        try:
            limit = int(raw)
        except ValueError as exc:
            raise serializers.ValidationError(
                {"limit": "Nombre invalide."}
            ) from exc
        if limit < 1:
            raise serializers.ValidationError({"limit": "Doit etre superieur a zero."})
        return min(limit, self.TOP_PRODUCTS_MAX_LIMIT)
