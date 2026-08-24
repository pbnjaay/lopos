from dataclasses import dataclass, field
from decimal import Decimal

from django.conf import settings
from django.db.models import Count, Q, QuerySet, Sum
from django.db.models.functions import Abs
from django.urls import reverse
from django.utils import timezone

from apps.cash.models import CashSession
from apps.inventory.models import Stock
from apps.sales.models import Payment, Sale, SaleItem, SaleReturn
from apps.stores.models import Store
from apps.sync.models import ProcessedSyncEvent

from .formatting import classify_cash_difference, format_cash_difference, format_count
from .period import DEFAULT_PERIOD, resolve_period_range

ZERO = Decimal("0.00")
MAX_ALERTS_DISPLAYED = 5
ALERTS_LOOKBACK_DAYS = 7


@dataclass(frozen=True, slots=True)
class TopProduct:
    product_id: str
    name: str
    quantity: Decimal
    url: str


@dataclass(frozen=True, slots=True)
class Alert:
    severity: str  # "critical" | "warning" | "info"
    text: str
    url: str


@dataclass(frozen=True, slots=True)
class ManagerDashboard:
    period: str
    store_id: str | None
    gross_sales: Decimal
    returns_total: Decimal
    net_sales: Decimal
    sales_count: int
    average_basket: Decimal
    payment_totals: dict[str, Decimal]
    payment_percentages: dict[str, int]
    open_sessions: list[CashSession]
    low_stock_threshold: int
    out_of_stock_count: int
    low_stock_count: int
    sales_url: str
    open_sessions_url: str
    alerts: list[Alert] = field(default_factory=list)
    top_products: list[TopProduct] = field(default_factory=list)
    recent_sales: list[Sale] = field(default_factory=list)


def _sales_changelist_url(period: str, store_id: str | None) -> str:
    url = f"{reverse('admin:sales_sale_changelist')}?period={period}"
    if store_id:
        url += f"&cash_session__cash_register__store__id__exact={store_id}"
    return url


def _open_sessions_url(store_id: str | None) -> str:
    url = f"{reverse('admin:cash_cashsession_changelist')}?status__exact=OPEN"
    if store_id:
        url += f"&cash_register__store__id__exact={store_id}"
    return url


def _completed_sales(period: str, store_id: str | None) -> QuerySet[Sale]:
    start, end = resolve_period_range(period)
    qs = Sale.objects.filter(
        status=Sale.Status.COMPLETED,
        occurred_at__gte=start,
        occurred_at__lt=end,
    )
    if store_id:
        qs = qs.filter(cash_session__cash_register__store_id=store_id)
    return qs


def _stock_queryset(store_id: str | None) -> QuerySet[Stock]:
    qs = Stock.objects.all()
    if store_id:
        qs = qs.filter(store_id=store_id)
    return qs


def _cash_session_alerts(store_id: str | None) -> tuple[list[Alert], list[Alert]]:
    """Returns (critical_shortages, other_significant_discrepancies)."""
    cutoff = timezone.now() - timezone.timedelta(days=ALERTS_LOOKBACK_DAYS)
    qs = (
        CashSession.objects.filter(status=CashSession.Status.CLOSED, closed_at__gte=cutoff)
        .exclude(difference=ZERO)
        .exclude(difference__isnull=True)
        .select_related("cash_register", "cash_register__store")
        .annotate(abs_difference=Abs("difference"))
        .order_by("-abs_difference")
    )
    if store_id:
        qs = qs.filter(cash_register__store_id=store_id)

    critical_shortages: list[Alert] = []
    other: list[Alert] = []
    for session in qs:
        severity = classify_cash_difference(session.difference)
        if severity == "info":
            continue
        alert = Alert(
            severity=severity,
            text=f"{format_cash_difference(session.difference)} — {session.cash_register}",
            url=reverse("admin:cash_cashsession_change", args=[session.pk]),
        )
        if severity == "critical" and session.difference < 0:
            critical_shortages.append(alert)
        else:
            other.append(alert)
    return critical_shortages, other


def _stock_alerts(
    store_id: str | None, out_of_stock_count: int, low_stock_count: int
) -> tuple[Alert | None, Alert | None]:
    base_url = reverse("admin:inventory_stock_changelist")
    store_query = f"&store__id__exact={store_id}" if store_id else ""

    out_alert = None
    if out_of_stock_count:
        out_alert = Alert(
            severity="critical",
            text=format_count(out_of_stock_count, "produit en rupture", "produits en rupture"),
            url=f"{base_url}?stock_status=out{store_query}",
        )

    low_alert = None
    if low_stock_count:
        low_alert = Alert(
            severity="warning",
            text=format_count(
                low_stock_count, "produit en stock faible", "produits en stock faible"
            ),
            url=f"{base_url}?stock_status=low{store_query}",
        )
    return out_alert, low_alert


def _sync_conflict_alert() -> Alert | None:
    cutoff = timezone.now() - timezone.timedelta(days=ALERTS_LOOKBACK_DAYS)
    count = ProcessedSyncEvent.objects.filter(
        stock_discrepancy=True, processed_at__gte=cutoff
    ).count()
    if not count:
        return None
    return Alert(
        severity="warning",
        text=format_count(
            count,
            "vente nécessite une vérification de synchronisation",
            "ventes nécessitent une vérification de synchronisation",
        ),
        url=reverse("admin:sync_processedsyncevent_changelist") + "?stock_discrepancy__exact=1",
    )


def _build_alerts(
    *, store_id: str | None, out_of_stock_count: int, low_stock_count: int
) -> list[Alert]:
    critical_shortages, other_cash = _cash_session_alerts(store_id)
    out_alert, low_alert = _stock_alerts(store_id, out_of_stock_count, low_stock_count)
    sync_alert = _sync_conflict_alert()

    ordered: list[Alert] = [*critical_shortages]
    if out_alert:
        ordered.append(out_alert)
    if sync_alert:
        ordered.append(sync_alert)
    ordered.extend(other_cash)
    if low_alert:
        ordered.append(low_alert)

    if len(ordered) > MAX_ALERTS_DISPLAYED:
        overflow = len(ordered) - MAX_ALERTS_DISPLAYED
        ordered = ordered[:MAX_ALERTS_DISPLAYED]
        ordered.append(
            Alert(
                severity="info",
                text=f"Voir toutes les alertes (+{overflow})",
                url=reverse("admin:cash_cashsession_changelist"),
            )
        )
    return ordered


def get_manager_dashboard(
    *, period: str = DEFAULT_PERIOD, store_id: str | None = None
) -> ManagerDashboard:
    if store_id and not Store.objects.filter(pk=store_id).exists():
        store_id = None

    sales = _completed_sales(period, store_id)

    totals = sales.aggregate(gross_sales=Sum("total"), sales_count=Count("id"))
    gross_sales = totals["gross_sales"] or ZERO
    start, end = resolve_period_range(period)
    returns_qs = SaleReturn.objects.filter(status=SaleReturn.Status.COMPLETED, created_at__gte=start, created_at__lt=end)
    if store_id:
        returns_qs = returns_qs.filter(cash_session__cash_register__store_id=store_id)
    returns_total = returns_qs.aggregate(total=Sum("total_refund"))["total"] or ZERO
    net_sales = gross_sales - returns_total
    sales_count = totals["sales_count"] or 0
    average_basket = (net_sales / sales_count) if sales_count else ZERO

    payment_aggregates = Payment.objects.filter(sale__in=sales).aggregate(
        cash=Sum("amount", filter=Q(method=Payment.Method.CASH)),
        wave=Sum("amount", filter=Q(method=Payment.Method.WAVE)),
        orange_money=Sum("amount", filter=Q(method=Payment.Method.ORANGE_MONEY)),
    )
    refund_aggregates = returns_qs.aggregate(
        cash=Sum("total_refund", filter=Q(payment_method=Payment.Method.CASH)),
        wave=Sum("total_refund", filter=Q(payment_method=Payment.Method.WAVE)),
        orange_money=Sum("total_refund", filter=Q(payment_method=Payment.Method.ORANGE_MONEY)),
    )
    payment_totals = {
        "cash": (payment_aggregates["cash"] or ZERO) - (refund_aggregates["cash"] or ZERO),
        "wave": (payment_aggregates["wave"] or ZERO) - (refund_aggregates["wave"] or ZERO),
        "orange_money": (payment_aggregates["orange_money"] or ZERO) - (refund_aggregates["orange_money"] or ZERO),
    }
    payment_percentages = {
        method: round(total / net_sales * 100) if net_sales else 0
        for method, total in payment_totals.items()
    }

    open_sessions_qs = CashSession.objects.filter(status=CashSession.Status.OPEN).select_related(
        "cash_register", "cash_register__store", "cashier"
    )
    if store_id:
        open_sessions_qs = open_sessions_qs.filter(cash_register__store_id=store_id)
    open_sessions = list(open_sessions_qs.order_by("cash_register__name"))

    threshold = getattr(settings, "LOW_STOCK_THRESHOLD_DEFAULT", 5)
    stock_qs = _stock_queryset(store_id)
    out_of_stock_count = stock_qs.filter(quantity__lte=0).count()
    low_stock_count = stock_qs.filter(quantity__gt=0, quantity__lte=threshold).count()

    top_products_qs = (
        SaleItem.objects.filter(sale__in=sales)
        .values("product_id", "product_name")
        .annotate(total_quantity=Sum("quantity"))
        .order_by("-total_quantity")[:5]
    )
    top_products = [
        TopProduct(
            product_id=str(row["product_id"]),
            name=row["product_name"],
            quantity=row["total_quantity"],
            url=reverse("admin:catalog_product_change", args=[row["product_id"]]),
        )
        for row in top_products_qs
    ]

    recent_sales = list(
        sales.select_related(
            "cash_session__cash_register", "cash_session__cash_register__store", "cashier", "payment"
        ).order_by("-occurred_at")[:10]
    )

    alerts = _build_alerts(
        store_id=store_id,
        out_of_stock_count=out_of_stock_count,
        low_stock_count=low_stock_count,
    )

    return ManagerDashboard(
        period=period,
        store_id=store_id,
        gross_sales=gross_sales,
        returns_total=returns_total,
        net_sales=net_sales,
        sales_count=sales_count,
        average_basket=average_basket,
        payment_totals=payment_totals,
        payment_percentages=payment_percentages,
        open_sessions=open_sessions,
        low_stock_threshold=threshold,
        out_of_stock_count=out_of_stock_count,
        low_stock_count=low_stock_count,
        sales_url=_sales_changelist_url(period, store_id),
        open_sessions_url=_open_sessions_url(store_id),
        alerts=alerts,
        top_products=top_products,
        recent_sales=recent_sales,
    )
