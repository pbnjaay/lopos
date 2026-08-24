from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.pagination import PageNumberPagination
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
from .access import get_pos_cash_session, returns_for_pos_session, sales_for_pos_session
from .models import Sale, SaleReturn
from .serializers import (
    CompleteSaleSerializer,
    CreateSaleReturnSerializer,
    SaleListQuerySerializer,
    SaleReturnSerializer,
    SaleSerializer,
    SaleSummarySerializer,
)
from .services import complete_sale, create_sale_return


class SalePagination(PageNumberPagination):
    page_size = 20
    page_size_query_param = "page_size"
    max_page_size = 100


def _pos_cash_session_or_error(request, cash_session_id):
    cash_session = get_pos_cash_session(
        user=request.user,
        cash_session_id=cash_session_id,
    )
    if cash_session is None:
        return None, Response(
            {
                "code": "OPEN_CASH_SESSION_REQUIRED",
                "message": "Une session de caisse ouverte vous appartenant est requise.",
            },
            status=status.HTTP_403_FORBIDDEN,
        )
    return cash_session, None


class CompleteSaleView(APIView):
    def get(self, request) -> Response:
        query_serializer = SaleListQuerySerializer(data=request.query_params)
        query_serializer.is_valid(raise_exception=True)
        filters = query_serializer.validated_data
        cash_session, error = _pos_cash_session_or_error(
            request, filters.get("cash_session_id")
        )
        if error is not None:
            return error

        queryset = (
            sales_for_pos_session(cash_session=cash_session)
            .select_related(
                "payment", "cashier", "cash_session__cash_register__store"
            )
            .prefetch_related("returns")
            .order_by("-occurred_at", "-created_at")
        )
        search = filters.get("search", "").strip()
        if search:
            queryset = queryset.filter(id__icontains=search)
        if date_from := filters.get("date_from"):
            queryset = queryset.filter(occurred_at__date__gte=date_from)
        if date_to := filters.get("date_to"):
            queryset = queryset.filter(occurred_at__date__lte=date_to)
        if cash_register_id := filters.get("cash_register_id"):
            queryset = queryset.filter(cash_session__cash_register_id=cash_register_id)
        if cashier_id := filters.get("cashier_id"):
            queryset = queryset.filter(cashier_id=cashier_id)
        if payment_method := filters.get("payment_method"):
            queryset = queryset.filter(payment__method=payment_method)

        paginator = SalePagination()
        page = paginator.paginate_queryset(queryset, request, view=self)
        serializer = SaleSummarySerializer(page, many=True)
        return paginator.get_paginated_response(serializer.data)

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
        query_serializer = SaleListQuerySerializer(data=request.query_params)
        query_serializer.is_valid(raise_exception=True)
        cash_session, error = _pos_cash_session_or_error(
            request, query_serializer.validated_data.get("cash_session_id")
        )
        if error is not None:
            return error
        sale = get_object_or_404(
            sales_for_pos_session(cash_session=cash_session).select_related(
                "payment", "cashier", "cash_session__cash_register__store"
            ).prefetch_related("items__return_items__sale_return", "returns"),
            pk=pk,
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
        query_serializer = SaleListQuerySerializer(data=request.query_params)
        query_serializer.is_valid(raise_exception=True)
        cash_session, error = _pos_cash_session_or_error(
            request, query_serializer.validated_data.get("cash_session_id")
        )
        if error is not None:
            return error
        sale_return = get_object_or_404(
            returns_for_pos_session(cash_session=cash_session)
            .select_related("created_by")
            .prefetch_related("items__original_sale_item"),
            pk=pk,
        )
        return Response(SaleReturnSerializer(sale_return).data)
