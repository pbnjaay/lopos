from decimal import Decimal

from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.cash.exceptions import CashSessionClosed
from apps.sales.access import get_pos_cash_session
from apps.sales.serializers import SaleListQuerySerializer
from apps.stores.models import Store
from apps.tenancy.context import get_tenant
from apps.tenancy.scoping import scope

from .exceptions import (
    CustomerOverpayment,
    DuplicateCustomer,
    InvalidCustomer,
    InvalidCustomerPayment,
    InvalidPhone,
)
from .models import Customer, CustomerLedgerEntry, CustomerPayment
from .serializers import (
    CreateCustomerPaymentSerializer,
    CreateCustomerSerializer,
    CustomerBookQuerySerializer,
    CustomerPaymentSerializer,
    CustomerSerializer,
    LedgerEntrySerializer,
)
from .services import create_customer, record_customer_payment, with_book_summary


def _accessible_store_or_error(request, store_id) -> tuple[Store | None, Response | None]:
    """Un magasin du compte ; sinon 404, qu'il n'existe pas ou appartienne à
    un autre commerce — rien ne doit permettre de distinguer les deux."""
    store = scope(Store.objects, get_tenant(request)).filter(pk=store_id).first()
    if store is None:
        return None, Response(
            {"code": "STORE_NOT_FOUND", "message": "Ce magasin n'existe pas."},
            status=status.HTTP_404_NOT_FOUND,
        )
    return store, None


def _customer_data(customer: Customer) -> dict:
    annotated = with_book_summary(Customer.objects.filter(pk=customer.pk)).get()
    return CustomerSerializer(annotated).data


class CustomerListCreateView(APIView):
    """Cahier d'un magasin : snapshot complet pour le cache local du POS
    (comme le catalogue produits), et création rapide depuis la caisse.

    La création est en ligne uniquement : un client créé hors ligne ne
    pourrait pas être dédoublonné, et une vente à crédit qui le référencerait
    serait rejetée à la synchronisation — la dette serait perdue.
    """

    def get(self, request) -> Response:
        query = CustomerBookQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        store, error = _accessible_store_or_error(request, query.validated_data["store_id"])
        if error is not None:
            return error
        customers = with_book_summary(Customer.objects.filter(store=store)).order_by("name", "id")
        return Response(CustomerSerializer(customers, many=True).data)

    def post(self, request) -> Response:
        serializer = CreateCustomerSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        store, error = _accessible_store_or_error(request, data["store_id"])
        if error is not None:
            return error

        try:
            customer = create_customer(
                store=store, name=data["name"], phone=data["phone"], created_by=request.user
            )
        except DuplicateCustomer as exc:
            return Response(
                {
                    "code": "CUSTOMER_DUPLICATE",
                    "message": str(exc),
                    "customer": _customer_data(exc.existing),
                },
                status=status.HTTP_409_CONFLICT,
            )
        except InvalidPhone as exc:
            return Response(
                {"code": "INVALID_PHONE", "message": str(exc)},
                status=status.HTTP_400_BAD_REQUEST,
            )
        except InvalidCustomer as exc:
            return Response(
                {"code": "INVALID_CUSTOMER", "message": str(exc)},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response(_customer_data(customer), status=status.HTTP_201_CREATED)


def _payment_response(payment: CustomerPayment, http_status: int) -> Response:
    payment = CustomerPayment.objects.select_related(
        "customer", "store", "created_by", "cash_session__cash_register"
    ).get(
        pk=payment.pk
    )
    return Response(CustomerPaymentSerializer(payment).data, status=http_status)


class CustomerDetailView(APIView):
    """Fiche client : solde et historique complet du cahier, du plus récent
    au plus ancien, chaque ligne portant le solde juste après elle.

    L'historique d'un cahier de boutique reste court (quelques centaines de
    lignes au plus) : il est renvoyé en entier, sans pagination.
    """

    def get(self, request, pk=None) -> Response:
        customer = get_object_or_404(
            scope(Customer.objects, get_tenant(request)).select_related("store"), pk=pk
        )

        entries = list(
            CustomerLedgerEntry.objects.filter(customer=customer)
            .select_related("customer_payment", "created_by")
            .order_by("occurred_at", "created_at", "id")
        )
        running = Decimal("0.00")
        for entry in entries:
            running += entry.amount
            entry.running_balance = running
        entries.reverse()

        return Response(
            {
                **_customer_data(customer),
                "entries": LedgerEntrySerializer(entries, many=True).data,
            }
        )


class CustomerPaymentCreateView(APIView):
    """Remboursement d'un client, en ligne uniquement.

    Idempotent sur `idempotency_key` : un POS qui renvoie la même requête
    après une coupure reçoit le paiement déjà enregistré, jamais un second.
    """

    def post(self, request) -> Response:
        serializer = CreateCustomerPaymentSerializer(
            data=request.data, context={"request": request}
        )
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        if data["cash_session"].cashier_id != request.user.pk:
            return Response(
                {
                    "code": "CASH_SESSION_NOT_OWNED",
                    "message": "Cette session appartient à un autre caissier.",
                },
                status=status.HTTP_403_FORBIDDEN,
            )

        try:
            payment = record_customer_payment(**data, created_by=request.user)
        except CashSessionClosed as exc:
            return Response(
                {"code": "CASH_SESSION_CLOSED", "message": str(exc)},
                status=status.HTTP_409_CONFLICT,
            )
        except CustomerOverpayment as exc:
            return Response(
                {
                    "code": "CUSTOMER_OVERPAYMENT",
                    "message": str(exc),
                    "balance": str(exc.balance),
                },
                status=status.HTTP_409_CONFLICT,
            )
        except InvalidCustomerPayment as exc:
            return Response(
                {"code": "INVALID_CUSTOMER_PAYMENT", "message": str(exc)},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return _payment_response(payment, status.HTTP_201_CREATED)


class CustomerPaymentDetailView(APIView):
    """Reçu d'un remboursement, limité au magasin de la session POS ouverte."""

    def get(self, request, pk=None) -> Response:
        query_serializer = SaleListQuerySerializer(data=request.query_params)
        query_serializer.is_valid(raise_exception=True)
        cash_session = get_pos_cash_session(
            user=request.user,
            cash_session_id=query_serializer.validated_data.get("cash_session_id"),
        )
        if cash_session is None:
            return Response(
                {
                    "code": "OPEN_CASH_SESSION_REQUIRED",
                    "message": "Une session de caisse ouverte vous appartenant est requise.",
                },
                status=status.HTTP_403_FORBIDDEN,
            )
        payment = get_object_or_404(
            CustomerPayment.objects.filter(store_id=cash_session.cash_register.store_id),
            pk=pk,
        )
        return _payment_response(payment, status.HTTP_200_OK)
