from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal

from django.conf import settings
from django.db.models import Count, F, Q, QuerySet, Sum
from django.db.models.functions import Abs, Coalesce
from django.urls import reverse
from django.utils import timezone

from apps.cash.models import CashSession
from apps.customers.models import CustomerLedgerEntry, CustomerPayment
from apps.expenses.models import Expense
from apps.inventory.models import Stock
from apps.sales.models import Payment, Sale, SaleItem, SaleReturn
from apps.stores.models import Store
from apps.sync.models import ProcessedSyncEvent

from .formatting import (
    classify_cash_difference,
    format_cash_difference,
    format_count,
    format_open_duration,
)
from .period import DEFAULT_PERIOD, DashboardPeriod, resolve_dashboard_period
from .profitability import ProfitabilitySummary, get_profitability_summary

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
class BookSummary:
    """Cahier clients vu par le gérant : ce qui a bougé sur la période, et ce
    qui reste dû aujourd'hui (l'encours ne dépend pas de la période)."""

    is_used: bool
    credit_granted: Decimal
    payments_received: Decimal
    outstanding: Decimal
    customers_url: str


@dataclass(frozen=True, slots=True)
class ExpenseCategoryTotal:
    name: str
    total: Decimal


@dataclass(frozen=True, slots=True)
class ExpenseSummary:
    """Argent sorti pour faire tourner la boutique sur la période. Jamais
    retranché du CA : « CA − dépenses » n'est pas un bénéfice. Les dépenses ne
    se retranchent que de la marge brute, dans le résultat estimé."""

    is_used: bool
    count: int
    total: Decimal
    by_method: dict[str, Decimal]
    top_categories: list[ExpenseCategoryTotal]
    expenses_url: str


@dataclass(frozen=True, slots=True)
class ManagerDashboard:
    period: str
    store_id: str | None
    period_label: str
    # Périmètre toujours écrit : jamais d'agrégation implicite de magasins.
    scope_label: str
    gross_sales: Decimal
    returns_total: Decimal
    net_sales: Decimal
    sales_count: int
    average_basket: Decimal
    payment_totals: dict[str, Decimal]
    payment_percentages: dict[str, int]
    # Part du CA net restée au cahier (mis au cahier − déduit par les retours) :
    # avec les trois moyens de paiement, elle complète le CA net.
    credit_total: Decimal
    credit_percentage: int
    book: "BookSummary"
    expenses: "ExpenseSummary"
    open_sessions: list[CashSession]
    low_stock_threshold: int
    out_of_stock_count: int
    low_stock_count: int
    sales_url: str
    open_sessions_url: str
    date_from: date | None = None
    date_to: date | None = None
    # Réservé à qui a la permission de voir coûts et marges (None sinon).
    profitability: ProfitabilitySummary | None = None
    alerts: list[Alert] = field(default_factory=list)
    top_products: list[TopProduct] = field(default_factory=list)
    recent_sales: list[Sale] = field(default_factory=list)


def _sales_changelist_url(period: DashboardPeriod, store_id: str | None) -> str:
    if period.is_custom:
        # Filtre de dates de la hiérarchie (jours locaux), bornes incluses.
        query = (
            f"occurred_at__date__gte={period.date_from.isoformat()}"
            f"&occurred_at__date__lte={period.date_to.isoformat()}"
        )
    else:
        query = f"period={period.key}"
    url = f"{reverse('admin:sales_sale_changelist')}?{query}"
    if store_id:
        url += f"&cash_session__cash_register__store__id__exact={store_id}"
    return url


def _open_sessions_url(store_id: str | None) -> str:
    url = f"{reverse('admin:cash_cashsession_changelist')}?status__exact=OPEN"
    if store_id:
        url += f"&cash_register__store__id__exact={store_id}"
    return url


def _completed_sales(start, end, store_id: str | None) -> QuerySet[Sale]:
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


def _stale_session_alerts(store_id: str | None) -> list[Alert]:
    """Sessions encore ouvertes au-delà du seuil — probable oubli de clôture."""
    threshold_hours = settings.STALE_CASH_SESSION_HOURS_THRESHOLD
    cutoff = timezone.now() - timezone.timedelta(hours=threshold_hours)
    qs = (
        CashSession.objects.filter(status=CashSession.Status.OPEN, opened_at__lte=cutoff)
        .select_related("cash_register", "cash_register__store")
        .order_by("opened_at")
    )
    if store_id:
        qs = qs.filter(cash_register__store_id=store_id)

    now = timezone.now()
    return [
        Alert(
            severity="warning",
            text=(
                f"{session.cash_register} ouverte depuis "
                f"{format_open_duration(int((now - session.opened_at).total_seconds() // 3600))}"
            ),
            url=reverse("admin:cash_cashsession_change", args=[session.pk]),
        )
        for session in qs
    ]


def _build_alerts(
    *, store_id: str | None, out_of_stock_count: int, low_stock_count: int
) -> list[Alert]:
    critical_shortages, other_cash = _cash_session_alerts(store_id)
    out_alert, low_alert = _stock_alerts(store_id, out_of_stock_count, low_stock_count)
    sync_alert = _sync_conflict_alert()
    stale_session_alerts = _stale_session_alerts(store_id)

    ordered: list[Alert] = [*critical_shortages]
    if out_alert:
        ordered.append(out_alert)
    ordered.extend(stale_session_alerts)
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


def _book_summary(*, start, end, store_id: str | None, credit_granted: Decimal) -> BookSummary:
    ledger = CustomerLedgerEntry.objects.all()
    payments = CustomerPayment.objects.filter(created_at__gte=start, created_at__lt=end)
    if store_id:
        ledger = ledger.filter(store_id=store_id)
        payments = payments.filter(store_id=store_id)
    ledger_totals = ledger.aggregate(outstanding=Sum("amount"), entries=Count("id"))
    url = f"{reverse('admin:customers_customer_changelist')}?balance=due"
    if store_id:
        url += f"&store__id__exact={store_id}"
    return BookSummary(
        is_used=bool(ledger_totals["entries"]),
        credit_granted=credit_granted,
        payments_received=payments.aggregate(total=Sum("amount"))["total"] or ZERO,
        outstanding=ledger_totals["outstanding"] or ZERO,
        customers_url=url,
    )


def _expense_summary(*, start, end, store_id: str | None) -> ExpenseSummary:
    scope = Expense.objects.all()
    if store_id:
        scope = scope.filter(store_id=store_id)
    in_period = Q(status=Expense.Status.POSTED, occurred_at__gte=start, occurred_at__lt=end)
    # Une seule requête : les totaux de la période, et si la boutique a déjà
    # saisi des dépenses (sinon la carte reste masquée).
    totals = scope.aggregate(
        ever=Count("id"),
        count=Count("id", filter=in_period),
        total=Sum("amount", filter=in_period),
        cash=Sum("amount", filter=in_period & Q(payment_method=Payment.Method.CASH)),
        wave=Sum("amount", filter=in_period & Q(payment_method=Payment.Method.WAVE)),
        orange_money=Sum("amount", filter=in_period & Q(payment_method=Payment.Method.ORANGE_MONEY)),
    )
    top_categories = [
        ExpenseCategoryTotal(name=row["category__name"], total=row["total"])
        for row in scope.filter(in_period)
        .values("category__name")
        .annotate(total=Sum("amount"))
        .order_by("-total", "category__name")[:3]
    ] if totals["count"] else []
    url = f"{reverse('admin:expenses_expense_changelist')}?status__exact={Expense.Status.POSTED}"
    if store_id:
        url += f"&store__id__exact={store_id}"
    return ExpenseSummary(
        is_used=bool(totals["ever"]),
        count=totals["count"],
        total=totals["total"] or ZERO,
        by_method={
            "cash": totals["cash"] or ZERO,
            "wave": totals["wave"] or ZERO,
            "orange_money": totals["orange_money"] or ZERO,
        },
        top_categories=top_categories,
        expenses_url=url,
    )


def get_manager_dashboard(
    *,
    period: str = DEFAULT_PERIOD,
    store_id: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    include_profitability: bool = False,
) -> ManagerDashboard:
    store = Store.objects.filter(pk=store_id).first() if store_id else None
    store_id = str(store.pk) if store else None
    dashboard_period = resolve_dashboard_period(period, date_from, date_to)
    start, end = dashboard_period.start, dashboard_period.end

    sales = _completed_sales(start, end, store_id)

    totals = sales.aggregate(
        gross_sales=Sum("total"), sales_count=Count("id"), credit_granted=Sum("credit_amount")
    )
    gross_sales = totals["gross_sales"] or ZERO
    returns_qs = SaleReturn.objects.filter(status=SaleReturn.Status.COMPLETED, created_at__gte=start, created_at__lt=end)
    if store_id:
        returns_qs = returns_qs.filter(cash_session__cash_register__store_id=store_id)
    return_totals = returns_qs.aggregate(total=Sum("total_refund"), credit=Sum("credit_reduction"))
    returns_total = return_totals["total"] or ZERO
    net_sales = gross_sales - returns_total
    sales_count = totals["sales_count"] or 0
    average_basket = (net_sales / sales_count) if sales_count else ZERO

    payment_aggregates = Payment.objects.filter(sale__in=sales).aggregate(
        cash=Sum("amount", filter=Q(method=Payment.Method.CASH)),
        wave=Sum("amount", filter=Q(method=Payment.Method.WAVE)),
        orange_money=Sum("amount", filter=Q(method=Payment.Method.ORANGE_MONEY)),
    )
    # Argent réellement rendu : la part d'un retour déduite du cahier n'est
    # jamais sortie de la caisse.
    money_refund = F("total_refund") - F("credit_reduction")
    refund_aggregates = returns_qs.aggregate(
        cash=Sum(money_refund, filter=Q(payment_method=Payment.Method.CASH)),
        wave=Sum(money_refund, filter=Q(payment_method=Payment.Method.WAVE)),
        orange_money=Sum(money_refund, filter=Q(payment_method=Payment.Method.ORANGE_MONEY)),
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
    credit_granted = totals["credit_granted"] or ZERO
    credit_total = credit_granted - (return_totals["credit"] or ZERO)
    credit_percentage = round(credit_total / net_sales * 100) if net_sales else 0
    book = _book_summary(start=start, end=end, store_id=store_id, credit_granted=credit_granted)
    expenses = _expense_summary(start=start, end=end, store_id=store_id)
    profitability = (
        get_profitability_summary(
            start=start, end=end, store_id=store_id, expenses_total=expenses.total
        )
        if include_profitability
        else None
    )

    open_sessions_qs = CashSession.objects.filter(status=CashSession.Status.OPEN).select_related(
        "cash_register", "cash_register__store", "cashier"
    )
    if store_id:
        open_sessions_qs = open_sessions_qs.filter(cash_register__store_id=store_id)
    open_sessions = list(open_sessions_qs.order_by("cash_register__name"))

    threshold = getattr(settings, "LOW_STOCK_THRESHOLD_DEFAULT", 5)
    # Un produit peut définir son propre seuil (sac de riz vs canette) ; à
    # défaut, on retombe sur le seuil global du commerce.
    stock_qs = _stock_queryset(store_id).annotate(
        effective_threshold=Coalesce("product__low_stock_threshold", threshold)
    )
    out_of_stock_count = stock_qs.filter(quantity__lte=0).count()
    low_stock_count = stock_qs.filter(
        quantity__gt=0, quantity__lte=F("effective_threshold")
    ).count()

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
            "cash_session__cash_register", "cash_session__cash_register__store", "cashier"
        )
        .prefetch_related("payments")
        .order_by("-occurred_at")[:10]
    )

    alerts = _build_alerts(
        store_id=store_id,
        out_of_stock_count=out_of_stock_count,
        low_stock_count=low_stock_count,
    )

    return ManagerDashboard(
        period=dashboard_period.key,
        store_id=store_id,
        period_label=dashboard_period.label,
        scope_label=store.name if store else "Tous les magasins",
        date_from=dashboard_period.date_from,
        date_to=dashboard_period.date_to,
        profitability=profitability,
        gross_sales=gross_sales,
        returns_total=returns_total,
        net_sales=net_sales,
        sales_count=sales_count,
        average_basket=average_basket,
        payment_totals=payment_totals,
        payment_percentages=payment_percentages,
        credit_total=credit_total,
        credit_percentage=credit_percentage,
        book=book,
        expenses=expenses,
        open_sessions=open_sessions,
        low_stock_threshold=threshold,
        out_of_stock_count=out_of_stock_count,
        low_stock_count=low_stock_count,
        sales_url=_sales_changelist_url(dashboard_period, store_id),
        open_sessions_url=_open_sessions_url(store_id),
        alerts=alerts,
        top_products=top_products,
        recent_sales=recent_sales,
    )
