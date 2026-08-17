from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from .exceptions import InvalidStockQuantity
from .serializers import StockInResultSerializer, StockInSerializer
from .services import receive_stock


class StockInView(APIView):
    def post(self, request) -> Response:
        serializer = StockInSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            result = receive_stock(**serializer.validated_data)
        except InvalidStockQuantity as exc:
            return Response(
                {"code": "INVALID_STOCK_QUANTITY", "message": str(exc)},
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
