from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.cash.exceptions import CashSessionClosed

from .exceptions import (
    CustomerNotFound,
    InsufficientCashForRefund,
    InsufficientStock,
    InvalidCancellation,
    InvalidPayment,
    InvalidSaleItems,
    ProductInactive,
    ProductNotFound,
    InvalidReturn,
)
from apps.tenancy.context import get_tenant
from apps.tenancy.scoping import scope

from . import approvals
from .access import get_pos_cash_session, returns_for_pos_session, sales_for_pos_session
from .models import Sale, SaleReturn
from .serializers import (
    ApprovalApproversQuerySerializer,
    CancelSaleSerializer,
    CompleteSaleSerializer,
    CreateApprovalSerializer,
    CreateSaleReturnSerializer,
    SaleListQuerySerializer,
    SaleReturnSerializer,
    SaleSerializer,
    SaleSummarySerializer,
)
from .services import cancel_sale, complete_sale, create_sale_return


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
            .select_related("cashier", "customer", "cash_session__cash_register__store")
            .prefetch_related("returns", "payments")
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
            # Un paiement mixte peut matcher plusieurs lignes de paiement à la
            # fois : distinct() évite qu'une même vente apparaisse en double.
            queryset = queryset.filter(payments__method=payment_method).distinct()

        paginator = SalePagination()
        page = paginator.paginate_queryset(queryset, request, view=self)
        serializer = SaleSummarySerializer(page, many=True)
        return paginator.get_paginated_response(serializer.data)

    def post(self, request) -> Response:
        serializer = CompleteSaleSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
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
            sale = complete_sale(**serializer.validated_data)
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
        except CustomerNotFound as exc:
            return Response(
                {"code": "CUSTOMER_NOT_FOUND", "message": str(exc)},
                status=status.HTTP_404_NOT_FOUND,
            )
        except (InvalidPayment, InvalidSaleItems) as exc:
            return Response(
                {"code": "INVALID_SALE", "message": str(exc)},
                status=status.HTTP_400_BAD_REQUEST,
            )

        sale = (
            Sale.objects.select_related(
                "cashier", "customer", "cash_session__cash_register__store"
            )
            .prefetch_related("items__return_items__sale_return", "returns", "payments")
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
            sales_for_pos_session(cash_session=cash_session)
            .select_related("cashier", "customer", "cash_session__cash_register__store")
            .prefetch_related("items__return_items__sale_return", "returns", "payments"),
            pk=pk,
        )
        return Response(SaleSerializer(sale).data, status=status.HTTP_200_OK)


class CancelSaleView(APIView):
    def post(self, request, pk=None) -> Response:
        # Une vente hors des magasins du compte n'existe pas pour lui : même
        # réponse qu'un identifiant inconnu, jamais un refus qui la trahirait.
        if not scope(Sale.objects, get_tenant(request)).filter(pk=pk).exists():
            return _sale_not_found()
        serializer = CancelSaleSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            sale = cancel_sale(
                sale_id=pk,
                cancelled_by=request.user,
                reason=serializer.validated_data["reason"],
                approval_token=serializer.validated_data["approval_token"],
            )
        except Sale.DoesNotExist:
            return _sale_not_found()
        except approvals.ApprovalRequired as exc:
            return _approval_required(exc)
        except InvalidCancellation as exc:
            return Response(
                {"code": "INVALID_CANCELLATION", "message": str(exc)},
                status=status.HTTP_409_CONFLICT,
            )

        sale = (
            Sale.objects.select_related(
                "cashier", "customer", "cash_session__cash_register__store"
            )
            .prefetch_related("items__return_items__sale_return", "returns", "payments")
            .get(pk=sale.pk)
        )
        return Response(SaleSerializer(sale).data, status=status.HTTP_200_OK)


def _approval_required(exc: Exception) -> Response:
    return Response(
        {"code": "MANAGER_APPROVAL_REQUIRED", "message": str(exc)},
        status=status.HTTP_403_FORBIDDEN,
    )


def _sale_not_found() -> Response:
    return Response(
        {"code": "SALE_NOT_FOUND", "message": "Cette vente n'existe pas."},
        status=status.HTTP_404_NOT_FOUND,
    )


class SaleReturnListCreateView(APIView):
    def post(self, request) -> Response:
        serializer = CreateSaleReturnSerializer(
            data=request.data, context={"request": request}
        )
        serializer.is_valid(raise_exception=True)
        try:
            sale_return = create_sale_return(**serializer.validated_data, created_by=request.user)
        except CashSessionClosed as exc:
            return Response({"code": "CASH_SESSION_CLOSED", "message": str(exc)}, status=status.HTTP_409_CONFLICT)
        except InsufficientCashForRefund as exc:
            return Response(
                {"code": "INSUFFICIENT_CASH", "message": str(exc), "available": f"{exc.available:.2f}"},
                status=status.HTTP_409_CONFLICT,
            )
        except InvalidReturn as exc:
            return Response({"code": "INVALID_RETURN", "message": str(exc)}, status=status.HTTP_409_CONFLICT)
        except approvals.ApprovalRequired as exc:
            return _approval_required(exc)
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


def _own_open_session(request, cash_session_id):
    """La session ouverte de l'appelant : seul le caissier à son poste
    demande une validation."""
    return get_pos_cash_session(user=request.user, cash_session_id=cash_session_id)


class ApprovalApproversView(APIView):
    """Qui peut valider sur ce poste : propriétaire et gérants du magasin
    ayant un code PIN. Les noms seulement."""

    def get(self, request) -> Response:
        query = ApprovalApproversQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        cash_session = _own_open_session(request, query.validated_data["cash_session_id"])
        if cash_session is None:
            return _open_session_required()
        approvers = approvals.approvers_for_store(cash_session.cash_register.store)
        return Response(
            [
                {"id": user.pk, "name": user.get_full_name() or user.username}
                for user in approvers
            ]
        )


class ApprovalCreateView(APIView):
    """Le gérant tape son PIN sur le poste du caissier : en échange, une
    validation signée, valable quelques minutes pour cette opération sur
    cette vente seulement."""

    def post(self, request) -> Response:
        serializer = CreateApprovalSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        cash_session = _own_open_session(request, data["cash_session_id"])
        if cash_session is None:
            return _open_session_required()
        try:
            approver = approvals.check_pin(
                store=cash_session.cash_register.store,
                approver_id=data["approver_id"],
                pin=data["pin"],
            )
        except approvals.ApprovalPinLocked as exc:
            return Response(
                {"code": "APPROVAL_PIN_LOCKED", "message": str(exc)},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )
        except approvals.InvalidApprovalPin as exc:
            return Response(
                {"code": "INVALID_APPROVAL_PIN", "message": str(exc)},
                status=status.HTTP_403_FORBIDDEN,
            )
        token = approvals.issue(
            approver=approver,
            cash_session=cash_session,
            action=data["action"],
            sale_id=data["sale_id"],
        )
        return Response(
            {
                "approval_token": token,
                "approver": {"id": approver.pk, "name": approver.get_full_name() or approver.username},
            },
            status=status.HTTP_201_CREATED,
        )


def _open_session_required() -> Response:
    return Response(
        {
            "code": "OPEN_CASH_SESSION_REQUIRED",
            "message": "Une session de caisse ouverte vous appartenant est requise.",
        },
        status=status.HTTP_403_FORBIDDEN,
    )
