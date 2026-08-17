from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from .exceptions import (
    CashRegisterInactive,
    CashSessionAlreadyOpen,
    InvalidOpeningBalance,
)
from .serializers import CashSessionSerializer, OpenCashSessionSerializer
from .services import open_cash_session


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
        except InvalidOpeningBalance as exc:
            return Response(
                {"code": "INVALID_OPENING_BALANCE", "message": str(exc)},
                status=status.HTTP_400_BAD_REQUEST,
            )

        return Response(
            CashSessionSerializer(cash_session).data,
            status=status.HTTP_201_CREATED,
        )
