from django.shortcuts import get_object_or_404
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.cash.models import CashSession
from apps.cash.serializers import CashSessionSerializer

from .models import CashRegister, Store
from .serializers import CashRegisterSerializer, StoreSerializer
from .access import cash_registers_accessible_to, stores_accessible_to


class StoreViewSet(
    mixins.CreateModelMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    queryset = Store.objects.all()
    serializer_class = StoreSerializer

    def get_queryset(self):
        return stores_accessible_to(self.request.user)


class CashRegisterViewSet(
    mixins.CreateModelMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    queryset = CashRegister.objects.select_related("store")
    serializer_class = CashRegisterSerializer

    def get_queryset(self):
        queryset = cash_registers_accessible_to(self.request.user)
        store_id = self.request.query_params.get("store_id")
        return queryset.filter(store_id=store_id) if store_id else queryset

    @action(detail=True, methods=("get",), url_path="current-session")
    def current_session(self, request, pk=None) -> Response:
        cash_register = self.get_object()
        session = get_object_or_404(
            CashSession.objects.select_related("cashier"),
            cash_register=cash_register,
            status=CashSession.Status.OPEN,
        )
        if session.cashier_id != request.user.pk and not request.user.is_staff:
            return Response(
                {
                    "code": "CASH_SESSION_NOT_OWNED",
                    "message": "Cette session appartient à un autre caissier.",
                },
                status=status.HTTP_403_FORBIDDEN,
            )
        return Response(CashSessionSerializer(session).data, status=status.HTTP_200_OK)
