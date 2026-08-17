from django.urls import include, path
from rest_framework.routers import DefaultRouter

from apps.accounts.views import CsrfCookieView, LoginView, LogoutView, MeView
from apps.cash.views import (
    CashSessionSummaryView,
    CloseCashSessionView,
    OpenCashSessionView,
)
from apps.catalog.views import ProductViewSet
from apps.inventory.views import StockInView
from apps.sales.views import CompleteSaleView, SaleDetailView
from apps.stores.views import CashRegisterViewSet, StoreViewSet
from apps.sync.views import SyncPullView, SyncPushView


router = DefaultRouter()
router.register("stores", StoreViewSet, basename="store")
router.register("cash-registers", CashRegisterViewSet, basename="cash-register")
router.register("products", ProductViewSet, basename="product")

urlpatterns = [
    path("", include(router.urls)),
    path("auth/csrf/", CsrfCookieView.as_view(), name="auth-csrf"),
    path("auth/login/", LoginView.as_view(), name="auth-login"),
    path("auth/logout/", LogoutView.as_view(), name="auth-logout"),
    path("auth/me/", MeView.as_view(), name="auth-me"),
    path("inventory/stock-in/", StockInView.as_view(), name="inventory-stock-in"),
    path(
        "cash-sessions/open/",
        OpenCashSessionView.as_view(),
        name="cash-session-open",
    ),
    path(
        "cash-sessions/<uuid:pk>/summary/",
        CashSessionSummaryView.as_view(),
        name="cash-session-summary",
    ),
    path(
        "cash-sessions/<uuid:pk>/close/",
        CloseCashSessionView.as_view(),
        name="cash-session-close",
    ),
    path("sales/", CompleteSaleView.as_view(), name="sale-complete"),
    path("sales/<uuid:pk>/", SaleDetailView.as_view(), name="sale-detail"),
    path("sync/push/", SyncPushView.as_view(), name="sync-push"),
    path("sync/pull/", SyncPullView.as_view(), name="sync-pull"),
]
