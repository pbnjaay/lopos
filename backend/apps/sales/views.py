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
    InvalidReturn,
)
from .models import Sale, SaleReturn
from .serializers import (
    CompleteSaleSerializer, SaleSerializer, CreateSaleReturnSerializer, SaleReturnSerializer
)
from .services import complete_sale, create_sale_return


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
            .prefetch_related("items__return_items__sale_return", "returns")
            .get(pk=sale.pk)
        )
        return Response(SaleSerializer(sale).data, status=status.HTTP_201_CREATED)


class SaleDetailView(APIView):
    def get(self, request, pk=None) -> Response:
        sale = get_object_or_404(
            Sale.objects.select_related(
                "payment", "cashier", "cash_session__cash_register__store"
            ).prefetch_related("items__return_items__sale_return", "returns"),
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


class SaleReturnListCreateView(APIView):
    def post(self, request) -> Response:
        serializer = CreateSaleReturnSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            sale_return = create_sale_return(**serializer.validated_data, created_by=request.user)
        except CashSessionClosed as exc:
            return Response({"code": "CASH_SESSION_CLOSED", "message": str(exc)}, status=status.HTTP_409_CONFLICT)
        except InvalidReturn as exc:
            return Response({"code": "INVALID_RETURN", "message": str(exc)}, status=status.HTTP_409_CONFLICT)
        sale_return = SaleReturn.objects.select_related("created_by").prefetch_related(
            "items__original_sale_item"
        ).get(pk=sale_return.pk)
        return Response(SaleReturnSerializer(sale_return).data, status=status.HTTP_201_CREATED)


class SaleReturnDetailView(APIView):
    def get(self, request, pk=None) -> Response:
        sale_return = get_object_or_404(
            SaleReturn.objects.select_related("created_by").prefetch_related("items__original_sale_item"), pk=pk
        )
        if sale_return.created_by_id != request.user.pk and not request.user.is_staff:
            return Response({"code": "RETURN_NOT_OWNED", "message": "Ce retour appartient à un autre caissier."}, status=status.HTTP_403_FORBIDDEN)
        return Response(SaleReturnSerializer(sale_return).data)
