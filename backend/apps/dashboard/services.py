from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal

from django.conf import settings
from django.db.models import Count, Q, QuerySet, Sum
from django.utils import timezone

from apps.cash.models import CashSession
from apps.inventory.models import Stock
from apps.sales.models import Payment, Sale, SaleItem

ZERO = Decimal("0.00")


def _today_range() -> tuple[datetime, datetime]:
    start = timezone.localtime().replace(hour=0, minute=0, second=0, microsecond=0)
    end = start + timezone.timedelta(days=1)
    return start, end


def _completed_sales_today() -> QuerySet[Sale]:
    start, end = _today_range()
    return Sale.objects.filter(
        status=Sale.Status.COMPLETED,
        occurred_at__gte=start,
        occurred_at__lt=end,
    )


@dataclass(frozen=True, slots=True)
class TopProduct:
    product_id: str
    name: str
    quantity: int


@dataclass(frozen=True, slots=True)
class ManagerDashboard:
    gross_sales_today: Decimal
    sales_count_today: int
    average_basket: Decimal
    payment_totals: dict[str, Decimal]
    open_sessions: list[CashSession]
    low_stock_threshold: int
    low_stock_items: list[Stock]
    low_stock_count: int
    cash_discrepancies: list[CashSession]
    top_products: list[TopProduct]
    recent_sales: list[Sale]


def get_manager_dashboard() -> ManagerDashboard:
    sales_today = _completed_sales_today()

    totals = sales_today.aggregate(gross_sales=Sum("total"), sales_count=Count("id"))
    gross_sales = totals["gross_sales"] or ZERO
    sales_count = totals["sales_count"] or 0
    average_basket = (gross_sales / sales_count) if sales_count else ZERO

    payment_totals = Payment.objects.filter(sale__in=sales_today).aggregate(
        cash=Sum("amount", filter=Q(method=Payment.Method.CASH)),
        wave=Sum("amount", filter=Q(method=Payment.Method.WAVE)),
        orange_money=Sum("amount", filter=Q(method=Payment.Method.ORANGE_MONEY)),
    )

    open_sessions = list(
        CashSession.objects.filter(status=CashSession.Status.OPEN)
        .select_related("cash_register", "cash_register__store", "cashier")
        .order_by("cash_register__name")
    )

    threshold = getattr(settings, "LOW_STOCK_THRESHOLD_DEFAULT", 5)
    low_stock_items = list(
        Stock.objects.select_related("product", "store")
        .filter(quantity__lte=threshold)
        .order_by("quantity")[:20]
    )
    low_stock_count = Stock.objects.filter(quantity__lte=threshold).count()

    cash_discrepancies = list(
        CashSession.objects.filter(status=CashSession.Status.CLOSED)
        .exclude(difference=ZERO)
        .select_related("cash_register", "cash_register__store", "cashier")
        .order_by("-closed_at")[:5]
    )

    top_products_qs = (
        SaleItem.objects.filter(sale__in=sales_today)
        .values("product_id", "product_name")
        .annotate(total_quantity=Sum("quantity"))
        .order_by("-total_quantity")[:5]
    )
    top_products = [
        TopProduct(
            product_id=str(row["product_id"]),
            name=row["product_name"],
            quantity=row["total_quantity"],
        )
        for row in top_products_qs
    ]

    recent_sales = list(
        sales_today.select_related(
            "cash_session__cash_register", "cashier", "payment"
        ).order_by("-occurred_at")[:10]
    )

    return ManagerDashboard(
        gross_sales_today=gross_sales,
        sales_count_today=sales_count,
        average_basket=average_basket,
        payment_totals={
            "cash": payment_totals["cash"] or ZERO,
            "wave": payment_totals["wave"] or ZERO,
            "orange_money": payment_totals["orange_money"] or ZERO,
        },
        open_sessions=open_sessions,
        low_stock_threshold=threshold,
        low_stock_items=low_stock_items,
        low_stock_count=low_stock_count,
        cash_discrepancies=cash_discrepancies,
        top_products=top_products,
        recent_sales=recent_sales,
    )
