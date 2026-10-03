from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from .exceptions import (
    CashRegisterInactive,
    CashRegisterNotAllowed,
    CashSessionAlreadyClosed,
    CashSessionAlreadyOpen,
    InvalidCountedCash,
    InvalidOpeningBalance,
    StoreInactive,
)
from .models import CashSession
from .serializers import (
    CashSessionSerializer,
    CashSessionSummarySerializer,
    CloseCashSessionSerializer,
    OpenCashSessionSerializer,
    summary_to_payload,
)
from .services import close_cash_session, get_cash_session_summary, open_cash_session


def _forbidden_if_not_owner(request, cash_session: CashSession) -> Response | None:
    if cash_session.cashier_id != request.user.pk and not request.user.is_staff:
        return Response(
            {
                "code": "CASH_SESSION_NOT_OWNED",
                "message": "Cette session appartient à un autre caissier.",
            },
            status=status.HTTP_403_FORBIDDEN,
        )
    return None


class OpenCashSessionView(APIView):
    def post(self, request) -> Response:
        serializer = OpenCashSessionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            cash_session = open_cash_session(
                **serializer.validated_data,
                cashier=request.user,
            )
        except CashSessionAlreadyOpen as exc:
            return Response(
                {"code": "CASH_SESSION_ALREADY_OPEN", "message": str(exc)},
                status=status.HTTP_409_CONFLICT,
            )
        except CashRegisterInactive as exc:
            return Response(
                {"code": "CASH_REGISTER_INACTIVE", "message": str(exc)},
                status=status.HTTP_409_CONFLICT,
            )
        except StoreInactive as exc:
            return Response(
                {"code": "STORE_INACTIVE", "message": str(exc)},
                status=status.HTTP_409_CONFLICT,
            )
        except CashRegisterNotAllowed as exc:
            return Response(
                {"code": "CASH_REGISTER_NOT_ALLOWED", "message": str(exc)},
                status=status.HTTP_403_FORBIDDEN,
            )
        except InvalidOpeningBalance as exc:
            return Response(
                {"code": "INVALID_OPENING_BALANCE", "message": str(exc)},
                status=status.HTTP_400_BAD_REQUEST,
            )

        return Response(
            CashSessionSerializer(cash_session).data,
            status=status.HTTP_201_CREATED,
        )


class CashSessionSummaryView(APIView):
    def get(self, request, pk=None) -> Response:
        cash_session = get_object_or_404(
            CashSession.objects.select_related("cash_register", "cashier"),
            pk=pk,
        )
        forbidden = _forbidden_if_not_owner(request, cash_session)
        if forbidden is not None:
            return forbidden

        summary = get_cash_session_summary(cash_session=cash_session)
        payload = CashSessionSummarySerializer(summary_to_payload(summary)).data
        return Response(payload, status=status.HTTP_200_OK)


class CloseCashSessionView(APIView):
    def post(self, request, pk=None) -> Response:
        cash_session = get_object_or_404(
            CashSession.objects.select_related("cash_register", "cashier"),
            pk=pk,
        )
        forbidden = _forbidden_if_not_owner(request, cash_session)
        if forbidden is not None:
            return forbidden

        serializer = CloseCashSessionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            closed_session = close_cash_session(
                cash_session=cash_session,
                counted_cash=serializer.validated_data["counted_cash"],
            )
        except CashSessionAlreadyClosed as exc:
            return Response(
                {"code": "CASH_SESSION_ALREADY_CLOSED", "message": str(exc)},
                status=status.HTTP_409_CONFLICT,
            )
        except InvalidCountedCash as exc:
            return Response(
                {"code": "INVALID_COUNTED_CASH", "message": str(exc)},
                status=status.HTTP_400_BAD_REQUEST,
            )

        summary = get_cash_session_summary(cash_session=closed_session)
        payload = CashSessionSummarySerializer(summary_to_payload(summary)).data
        return Response(payload, status=status.HTTP_200_OK)
