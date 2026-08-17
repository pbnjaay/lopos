from django.urls import include, path
from rest_framework.routers import DefaultRouter

from apps.cash.views import OpenCashSessionView
from apps.catalog.views import ProductViewSet
from apps.inventory.views import StockInView
from apps.sales.views import CompleteSaleView
from apps.stores.views import CashRegisterViewSet, StoreViewSet


router = DefaultRouter()
router.register("stores", StoreViewSet, basename="store")
router.register("cash-registers", CashRegisterViewSet, basename="cash-register")
router.register("products", ProductViewSet, basename="product")

urlpatterns = [
    path("", include(router.urls)),
    path("auth/", include("rest_framework.urls")),
    path("inventory/stock-in/", StockInView.as_view(), name="inventory-stock-in"),
    path(
        "cash-sessions/open/",
        OpenCashSessionView.as_view(),
        name="cash-session-open",
    ),
    path("sales/", CompleteSaleView.as_view(), name="sale-complete"),
]
