from django.shortcuts import get_object_or_404
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.cash.models import CashSession
from apps.cash.serializers import CashSessionSerializer

from .models import CashRegister, Store
from .serializers import CashRegisterSerializer, StoreSerializer


class StoreViewSet(
    mixins.CreateModelMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    queryset = Store.objects.all()
    serializer_class = StoreSerializer


class CashRegisterViewSet(
    mixins.CreateModelMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    queryset = CashRegister.objects.select_related("store")
    serializer_class = CashRegisterSerializer

    @action(detail=True, methods=("get",), url_path="current-session")
    def current_session(self, request, pk=None) -> Response:
        cash_register = self.get_object()
        session = get_object_or_404(
            CashSession.objects.select_related("cashier"),
            cash_register=cash_register,
            status=CashSession.Status.OPEN,
        )
        return Response(CashSessionSerializer(session).data, status=status.HTTP_200_OK)
