from django.urls import include, path
from rest_framework.routers import DefaultRouter

from apps.accounts.views import CsrfCookieView, LoginView, LogoutView, MeView
from apps.cash.views import (
    CashSessionSummaryView,
    CloseCashSessionView,
    OpenCashSessionView,
)
from apps.catalog.views import ProductViewSet
from apps.customers.views import (
    CustomerDetailView,
    CustomerListCreateView,
    CustomerPaymentCreateView,
    CustomerPaymentDetailView,
)
from apps.expenses.views import (
    ExpenseCancelView,
    ExpenseCategoryListView,
    ExpenseDetailView,
    ExpenseListCreateView,
)
from apps.inventory.views import StockInView
from apps.sales.views import (
    CancelSaleView,
    CompleteSaleView,
    SaleDetailView,
    SaleReturnListCreateView,
    SaleReturnDetailView,
)
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
    path("sales/<uuid:pk>/cancel/", CancelSaleView.as_view(), name="sale-cancel"),
    path("returns/", SaleReturnListCreateView.as_view(), name="sale-return-list"),
    path("returns/<uuid:pk>/", SaleReturnDetailView.as_view(), name="sale-return-detail"),
    path("customers/", CustomerListCreateView.as_view(), name="customer-list"),
    path("customers/<uuid:pk>/", CustomerDetailView.as_view(), name="customer-detail"),
    path(
        "customer-payments/",
        CustomerPaymentCreateView.as_view(),
        name="customer-payment-create",
    ),
    path(
        "customer-payments/<uuid:pk>/",
        CustomerPaymentDetailView.as_view(),
        name="customer-payment-detail",
    ),
    path(
        "expense-categories/",
        ExpenseCategoryListView.as_view(),
        name="expense-category-list",
    ),
    path("expenses/", ExpenseListCreateView.as_view(), name="expense-list"),
    path("expenses/<uuid:pk>/", ExpenseDetailView.as_view(), name="expense-detail"),
    path("expenses/<uuid:pk>/cancel/", ExpenseCancelView.as_view(), name="expense-cancel"),
    path("sync/push/", SyncPushView.as_view(), name="sync-push"),
    path("sync/pull/", SyncPullView.as_view(), name="sync-pull"),
]
