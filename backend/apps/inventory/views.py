from rest_framework import status
from rest_framework.permissions import BasePermission, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.tenancy.permissions import HasActiveTenant

from .exceptions import InvalidStockCost, InvalidStockQuantity
from .serializers import StockInResultSerializer, StockInSerializer
from .services import receive_stock


class CanReceiveStock(BasePermission):
    """Une entrée de stock fixe aussi le coût d'achat, donc la valeur du stock
    et les marges : même droit que la réception dans l'admin, jamais un
    simple caissier."""

    message = "Vous n'avez pas le droit d'enregistrer une entrée de stock."

    def has_permission(self, request, view) -> bool:
        return request.user.has_perm("catalog.change_product")


class StockInView(APIView):
    permission_classes = (IsAuthenticated, HasActiveTenant, CanReceiveStock)

    def post(self, request) -> Response:
        serializer = StockInSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)

        try:
            result = receive_stock(**serializer.validated_data, created_by=request.user)
        except InvalidStockQuantity as exc:
            return Response(
                {"code": "INVALID_STOCK_QUANTITY", "message": str(exc)},
                status=status.HTTP_400_BAD_REQUEST,
            )
        except InvalidStockCost as exc:
            return Response(
                {"code": "INVALID_STOCK_COST", "message": str(exc)},
                status=status.HTTP_400_BAD_REQUEST,
            )

        response = StockInResultSerializer(
            {
                "product_id": result.stock.product_id,
                "store_id": result.stock.store_id,
                "quantity_added": result.quantity_added,
                "current_stock": result.stock.quantity,
            }
        )
        return Response(response.data, status=status.HTTP_201_CREATED)
