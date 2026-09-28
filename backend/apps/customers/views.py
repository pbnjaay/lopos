from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.cash.exceptions import CashSessionClosed
from apps.sales.access import get_pos_cash_session
from apps.sales.serializers import SaleListQuerySerializer

from .exceptions import CustomerOverpayment, InvalidCustomerPayment
from .models import CustomerPayment
from .serializers import CreateCustomerPaymentSerializer, CustomerPaymentSerializer
from .services import record_customer_payment


def _payment_response(payment: CustomerPayment, http_status: int) -> Response:
    payment = CustomerPayment.objects.select_related("customer", "store", "created_by").get(
        pk=payment.pk
    )
    return Response(CustomerPaymentSerializer(payment).data, status=http_status)


class CustomerPaymentCreateView(APIView):
    """Remboursement d'un client, en ligne uniquement.

    Idempotent sur `idempotency_key` : un POS qui renvoie la même requête
    après une coupure reçoit le paiement déjà enregistré, jamais un second.
    """

    def post(self, request) -> Response:
        serializer = CreateCustomerPaymentSerializer(data=request.data)
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
