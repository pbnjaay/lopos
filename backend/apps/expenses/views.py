from django.db.models import Count, Q, QuerySet, Sum
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.cash.exceptions import CashSessionClosed
from apps.sales.access import get_pos_cash_session
from apps.tenancy.context import get_tenant
from apps.tenancy.scoping import scope

from .exceptions import (
    ExpenseAlreadyCancelled,
    ExpenseCancellationNotAllowed,
    ExpenseNotCancellable,
    ExpenseSessionNotOwned,
    InsufficientCash,
    InvalidExpense,
)
from .models import Expense, ExpenseCategory
from .serializers import (
    CancelExpenseSerializer,
    CreateExpenseSerializer,
    ExpenseCategorySerializer,
    ExpenseListQuerySerializer,
    ExpenseSerializer,
)
from .services import cancel_expense, create_expense

ZERO = "0.00"


class ExpensePagination(PageNumberPagination):
    page_size = 20
    page_size_query_param = "page_size"
    max_page_size = 100


def _with_relations(queryset: QuerySet[Expense]) -> QuerySet[Expense]:
    return queryset.select_related(
        "category", "store", "created_by", "cancelled_by", "cash_session__cash_register"
    )


def _expense_response(request, expense: Expense, http_status: int) -> Response:
    expense = _with_relations(Expense.objects.all()).get(pk=expense.pk)
    return Response(
        ExpenseSerializer(expense, context={"request": request}).data, status=http_status
    )


def _totals(queryset: QuerySet[Expense]) -> dict:
    """Totaux du filtre courant, dépenses annulées exclues : ce qui est
    réellement sorti, par moyen de paiement."""
    totals = queryset.filter(status=Expense.Status.POSTED).aggregate(
        count=Count("id"),
        total=Sum("amount"),
        cash=Sum("amount", filter=Q(payment_method="CASH")),
        wave=Sum("amount", filter=Q(payment_method="WAVE")),
        orange_money=Sum("amount", filter=Q(payment_method="ORANGE_MONEY")),
    )
    return {
        "count": totals["count"],
        **{
            key: f"{totals[key]:.2f}" if totals[key] is not None else ZERO
            for key in ("total", "cash", "wave", "orange_money")
        },
    }


class ExpenseCategoryListView(APIView):
    """Catégories proposées à la saisie : seulement les actives."""

    def get(self, request) -> Response:
        categories = scope(ExpenseCategory.objects, get_tenant(request)).filter(is_active=True)
        return Response(ExpenseCategorySerializer(categories, many=True).data)


class ExpenseListCreateView(APIView):
    def get(self, request) -> Response:
        """Dépenses de la boutique de la session ouverte, comme l'historique
        des ventes : du plus récent au plus ancien, paginé, avec les totaux
        du filtre."""
        query = ExpenseListQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        filters = query.validated_data
        cash_session = get_pos_cash_session(
            user=request.user, cash_session_id=filters.get("cash_session_id")
        )
        if cash_session is None:
            return Response(
                {
                    "code": "OPEN_CASH_SESSION_REQUIRED",
                    "message": "Une session de caisse ouverte vous appartenant est requise.",
                },
                status=status.HTTP_403_FORBIDDEN,
            )

        queryset = Expense.objects.filter(store_id=cash_session.cash_register.store_id)
        if date_from := filters.get("date_from"):
            queryset = queryset.filter(occurred_at__date__gte=date_from)
        if date_to := filters.get("date_to"):
            queryset = queryset.filter(occurred_at__date__lte=date_to)
        if category_id := filters.get("category_id"):
            queryset = queryset.filter(category_id=category_id)
        if payment_method := filters.get("payment_method"):
            queryset = queryset.filter(payment_method=payment_method)
        if expense_status := filters.get("status"):
            queryset = queryset.filter(status=expense_status)

        paginator = ExpensePagination()
        page = paginator.paginate_queryset(
            _with_relations(queryset).order_by("-occurred_at", "-created_at"),
            request,
            view=self,
        )
        response = paginator.get_paginated_response(
            ExpenseSerializer(page, many=True, context={"request": request}).data
        )
        response.data["totals"] = _totals(queryset)
        return response

    def post(self, request) -> Response:
        """Saisie en ligne uniquement, dans la session ouverte de l'appelant.

        Idempotent sur `idempotency_key` : un POS qui renvoie la même requête
        après une coupure reçoit la dépense déjà enregistrée, jamais une
        seconde.
        """
        serializer = CreateExpenseSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        if data["cash_session"].cashier_id != request.user.pk:
            return _not_owned()

        try:
            expense = create_expense(**data, created_by=request.user)
        except CashSessionClosed as exc:
            return Response(
                {"code": "CASH_SESSION_CLOSED", "message": str(exc)},
                status=status.HTTP_409_CONFLICT,
            )
        except ExpenseSessionNotOwned:
            return _not_owned()
        except InsufficientCash as exc:
            return Response(
                {
                    "code": "INSUFFICIENT_CASH",
                    "message": str(exc),
                    "available": f"{exc.available:.2f}",
                },
                status=status.HTTP_409_CONFLICT,
            )
        except InvalidExpense as exc:
            return Response(
                {"code": "INVALID_EXPENSE", "message": str(exc)},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return _expense_response(request, expense, status.HTTP_201_CREATED)


def _not_owned() -> Response:
    return Response(
        {
            "code": "CASH_SESSION_NOT_OWNED",
            "message": "Cette session appartient à un autre caissier.",
        },
        status=status.HTTP_403_FORBIDDEN,
    )


def _accessible_expense(request, pk) -> Expense:
    return get_object_or_404(
        _with_relations(scope(Expense.objects, get_tenant(request))),
        pk=pk,
    )


class ExpenseDetailView(APIView):
    def get(self, request, pk=None) -> Response:
        expense = _accessible_expense(request, pk)
        return Response(ExpenseSerializer(expense, context={"request": request}).data)


class ExpenseCancelView(APIView):
    def post(self, request, pk=None) -> Response:
        expense = _accessible_expense(request, pk)
        serializer = CancelExpenseSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            expense = cancel_expense(
                expense=expense,
                cancelled_by=request.user,
                reason=serializer.validated_data["reason"],
            )
        except ExpenseAlreadyCancelled as exc:
            return Response(
                {"code": "EXPENSE_ALREADY_CANCELLED", "message": str(exc)},
                status=status.HTTP_409_CONFLICT,
            )
        except ExpenseNotCancellable as exc:
            return Response(
                {"code": "EXPENSE_NOT_CANCELLABLE", "message": str(exc)},
                status=status.HTTP_409_CONFLICT,
            )
        except ExpenseCancellationNotAllowed as exc:
            return Response(
                {"code": "EXPENSE_CANCELLATION_NOT_ALLOWED", "message": str(exc)},
                status=status.HTTP_403_FORBIDDEN,
            )
        except InvalidExpense as exc:
            return Response(
                {"code": "INVALID_EXPENSE", "message": str(exc)},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return _expense_response(request, expense, status.HTTP_200_OK)
