from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.db.models import Count, Q, Sum
from django.utils import timezone

from apps.observability.sentry_context import tag_cash_session_scope
from apps.stores.models import CashRegister

from .exceptions import (
    CashRegisterInactive,
    CashSessionAlreadyClosed,
    CashSessionAlreadyOpen,
    InvalidCountedCash,
    InvalidOpeningBalance,
)
from .models import CashSession


User = get_user_model()

ZERO = Decimal("0.00")


@transaction.atomic
def open_cash_session(
    *,
    cash_register: CashRegister,
    cashier: User,
    opening_balance: Decimal | int,
) -> CashSession:
    if isinstance(opening_balance, bool) or not isinstance(
        opening_balance, (Decimal, int)
    ):
        raise InvalidOpeningBalance(
            "Le fond de caisse doit être un montant exact positif ou nul."
        )

    normalized_balance = Decimal(opening_balance)
    if normalized_balance < Decimal("0"):
        raise InvalidOpeningBalance(
            "Le fond de caisse doit être un montant exact positif ou nul."
        )

    locked_register = CashRegister.objects.select_for_update().get(
        pk=cash_register.pk
    )

    if not locked_register.is_active:
        raise CashRegisterInactive("Cette caisse est inactive.")

    if CashSession.objects.filter(
        cash_register=locked_register,
        status=CashSession.Status.OPEN,
    ).exists():
        raise CashSessionAlreadyOpen("Cette caisse possède déjà une session ouverte.")

    try:
        with transaction.atomic():
            return CashSession.objects.create(
                cash_register=locked_register,
                cashier=cashier,
                opening_balance=normalized_balance,
                status=CashSession.Status.OPEN,
            )
    except IntegrityError as exc:
        if CashSession.objects.filter(
            cash_register=locked_register,
            status=CashSession.Status.OPEN,
        ).exists():
            raise CashSessionAlreadyOpen(
                "Cette caisse possède déjà une session ouverte."
            ) from exc
        raise


@dataclass(frozen=True, slots=True)
class CashSessionSummary:
    cash_session: CashSession
    sales_count: int
    gross_sales: Decimal
    returns_total: Decimal
    net_sales: Decimal
    cash_sales: Decimal
    wave_sales: Decimal
    orange_money_sales: Decimal
    cash_refunds: Decimal
    wave_refunds: Decimal
    orange_money_refunds: Decimal
    opening_balance: Decimal
    expected_cash: Decimal
    counted_cash: Decimal | None
    cash_difference: Decimal | None
    closed_at: datetime | None


def _aggregate_totals(cash_session: CashSession):
    from apps.sales.models import Payment, Sale, SaleReturn

    sale_totals = Sale.objects.filter(
        cash_session=cash_session,
        status=Sale.Status.COMPLETED,
    ).aggregate(
        sales_count=Count("id"),
        gross_sales=Sum("total"),
    )
    payment_totals = Payment.objects.filter(
        sale__cash_session=cash_session,
        sale__status=Sale.Status.COMPLETED,
    ).aggregate(
        cash=Sum("amount", filter=Q(method="CASH")),
        wave=Sum("amount", filter=Q(method="WAVE")),
        orange_money=Sum("amount", filter=Q(method="ORANGE_MONEY")),
    )
    refunds = SaleReturn.objects.filter(
        cash_session=cash_session, status=SaleReturn.Status.COMPLETED
    ).aggregate(
        total=Sum("total_refund"),
        cash=Sum("total_refund", filter=Q(payment_method="CASH")),
        wave=Sum("total_refund", filter=Q(payment_method="WAVE")),
        orange_money=Sum("total_refund", filter=Q(payment_method="ORANGE_MONEY")),
    )

    return (
        sale_totals["sales_count"] or 0,
        sale_totals["gross_sales"] or ZERO,
        payment_totals["cash"] or ZERO,
        payment_totals["wave"] or ZERO,
        payment_totals["orange_money"] or ZERO,
        refunds["total"] or ZERO,
        refunds["cash"] or ZERO,
        refunds["wave"] or ZERO,
        refunds["orange_money"] or ZERO,
    )


def get_cash_session_summary(*, cash_session: CashSession) -> CashSessionSummary:
    (
        sales_count,
        gross_sales,
        cash_sales,
        wave_sales,
        orange_money_sales,
        returns_total,
        cash_refunds,
        wave_refunds,
        orange_money_refunds,
    ) = _aggregate_totals(cash_session)

    expected_cash = cash_session.opening_balance + cash_sales - cash_refunds

    return CashSessionSummary(
        cash_session=cash_session,
        sales_count=sales_count,
        gross_sales=gross_sales,
        returns_total=returns_total,
        net_sales=gross_sales - returns_total,
        cash_sales=cash_sales,
        wave_sales=wave_sales,
        orange_money_sales=orange_money_sales,
        cash_refunds=cash_refunds,
        wave_refunds=wave_refunds,
        orange_money_refunds=orange_money_refunds,
        opening_balance=cash_session.opening_balance,
        expected_cash=expected_cash,
        counted_cash=cash_session.closing_balance,
        cash_difference=cash_session.difference,
        closed_at=cash_session.closed_at,
    )


@transaction.atomic
def close_cash_session(
    *,
    cash_session: CashSession,
    counted_cash: Decimal | int,
) -> CashSession:
    if isinstance(counted_cash, bool) or not isinstance(counted_cash, (Decimal, int)):
        raise InvalidCountedCash(
            "Le montant compté doit être un montant exact positif ou nul."
        )

    normalized_counted = Decimal(counted_cash)
    if normalized_counted < Decimal("0"):
        raise InvalidCountedCash(
            "Le montant compté doit être un montant exact positif ou nul."
        )

    locked_session = (
        CashSession.objects.select_for_update()
        .select_related("cash_register", "cashier")
        .get(pk=cash_session.pk)
    )

    if locked_session.status != CashSession.Status.OPEN:
        raise CashSessionAlreadyClosed("Cette session de caisse est déjà clôturée.")

    tag_cash_session_scope(
        cash_session_id=locked_session.id,
        store_id=locked_session.cash_register.store_id,
    )

    _, _, cash_sales, _, _, _, cash_refunds, _, _ = _aggregate_totals(locked_session)
    expected_cash = locked_session.opening_balance + cash_sales - cash_refunds
    difference = normalized_counted - expected_cash

    locked_session.closing_balance = normalized_counted
    locked_session.expected_balance = expected_cash
    locked_session.difference = difference
    locked_session.closed_at = timezone.now()
    locked_session.status = CashSession.Status.CLOSED
    locked_session.save(
        update_fields=(
            "closing_balance",
            "expected_balance",
            "difference",
            "closed_at",
            "status",
        )
    )

    return locked_session
