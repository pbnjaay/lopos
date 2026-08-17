from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.cash.exceptions import CashSessionClosed

from .exceptions import (
    InsufficientStock,
    InvalidPayment,
    InvalidSaleItems,
    ProductInactive,
    ProductNotFound,
)
from .models import Sale
from .serializers import CompleteSaleSerializer, SaleSerializer
from .services import complete_sale


class CompleteSaleView(APIView):
    def post(self, request) -> Response:
        serializer = CompleteSaleSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        payment = serializer.validated_data.pop("payment")
        cash_session = serializer.validated_data["cash_session"]
        if cash_session.cashier_id != request.user.pk:
            return Response(
                {
                    "code": "CASH_SESSION_NOT_OWNED",
                    "message": "Cette session appartient à un autre caissier.",
                },
                status=status.HTTP_403_FORBIDDEN,
            )

        try:
            sale = complete_sale(
                **serializer.validated_data,
                payment_method=payment["method"],
                received_amount=payment.get("received_amount"),
            )
        except InsufficientStock as exc:
            return Response(
                {"code": "INSUFFICIENT_STOCK", "message": str(exc)},
                status=status.HTTP_409_CONFLICT,
            )
        except CashSessionClosed as exc:
            return Response(
                {"code": "CASH_SESSION_CLOSED", "message": str(exc)},
                status=status.HTTP_409_CONFLICT,
            )
        except ProductInactive as exc:
            return Response(
                {"code": "PRODUCT_INACTIVE", "message": str(exc)},
                status=status.HTTP_409_CONFLICT,
            )
        except ProductNotFound as exc:
            return Response(
                {"code": "PRODUCT_NOT_FOUND", "message": str(exc)},
                status=status.HTTP_404_NOT_FOUND,
            )
        except (InvalidPayment, InvalidSaleItems) as exc:
            return Response(
                {"code": "INVALID_SALE", "message": str(exc)},
                status=status.HTTP_400_BAD_REQUEST,
            )

        sale = (
            Sale.objects.select_related(
                "payment", "cashier", "cash_session__cash_register__store"
            )
            .prefetch_related("items")
            .get(pk=sale.pk)
        )
        return Response(SaleSerializer(sale).data, status=status.HTTP_201_CREATED)


class SaleDetailView(APIView):
    def get(self, request, pk=None) -> Response:
        sale = get_object_or_404(
            Sale.objects.select_related(
                "payment", "cashier", "cash_session__cash_register__store"
            ).prefetch_related("items"),
            pk=pk,
        )
        if sale.cashier_id != request.user.pk and not request.user.is_staff:
            return Response(
                {
                    "code": "SALE_NOT_OWNED",
                    "message": "Cette vente appartient à un autre caissier.",
                },
                status=status.HTTP_403_FORBIDDEN,
            )

        return Response(SaleSerializer(sale).data, status=status.HTTP_200_OK)
