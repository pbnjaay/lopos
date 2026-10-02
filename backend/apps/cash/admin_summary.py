"""Fiche d'une session de caisse dans l'admin, lue comme son rapport Z.

Le tiroir espèces suit ligne à ligne la seule formule de l'attendu
(`services._expected_cash`) : fond + ventes espèces − retours espèces +
remboursements cahier espèces − dépenses espèces. Les montants arrivent
formatés ; le template n'a qu'à les placer.
"""

from dataclasses import dataclass, field
from decimal import Decimal

from django.conf import settings
from django.utils import timezone

from apps.dashboard.formatting import format_fcfa

from .models import CashSession
from .services import get_cash_session_summary


@dataclass(frozen=True, slots=True)
class Row:
    label: str
    amount: str
    # « + » / « − » : sens de la ligne dans le calcul du tiroir.
    sign: str = ""
    # Ligne de détail (« dont … »), affichée en retrait.
    detail: bool = False


@dataclass(frozen=True, slots=True)
class SessionZ:
    register: str
    cashier: str
    is_open: bool
    status_label: str
    opened_at: str
    closed_at: str | None
    duration: str | None
    drawer: list[Row] = field(default_factory=list)
    expected: str = ""
    counted: str | None = None
    # (clé de couleur, texte) de l'écart, ou None tant que la session est ouverte.
    difference: tuple[str, str] | None = None
    sales_count: int = 0
    sales: list[Row] = field(default_factory=list)
    other: list[Row] = field(default_factory=list)
    report_url: str | None = None


def _local(value) -> str:
    return timezone.localtime(value).strftime("%d/%m/%Y à %H:%M")


def _duration(start, end) -> str:
    minutes = int((end - start).total_seconds() // 60)
    hours, minutes = divmod(minutes, 60)
    if hours >= 24:
        # Session oubliée ouverte : « 21 j 10 h » se lit, « 514 h 29 » non.
        days, hours = divmod(hours, 24)
        return f"{days} j {hours} h"
    return f"{hours} h {minutes:02d}" if hours else f"{minutes} min"


def _difference(value: Decimal | None) -> tuple[str, str] | None:
    if value is None:
        return None
    if value == 0:
        return "success", "OK — 0 FCFA"
    if value > 0:
        return "warning", f"Surplus — {format_fcfa(value)}"
    return "danger", f"Manque — {format_fcfa(abs(value))}"


def build_session_z(session: CashSession) -> SessionZ:
    summary = get_cash_session_summary(cash_session=session)
    is_open = session.status == CashSession.Status.OPEN
    end = session.closed_at or timezone.now()

    drawer = [
        Row("Fond de caisse", format_fcfa(summary.opening_balance)),
        Row("Ventes en espèces", format_fcfa(summary.cash_sales), "+"),
        Row("Retours remboursés en espèces", format_fcfa(summary.cash_refunds), "−"),
        Row("Remboursements cahier en espèces", format_fcfa(summary.cash_customer_payments), "+"),
        Row("Dépenses en espèces", format_fcfa(summary.cash_expenses), "−"),
    ]
    sales = [
        Row("Chiffre d'affaires", format_fcfa(summary.gross_sales)),
        Row("Retours", format_fcfa(summary.returns_total), "−"),
        Row("Chiffre d'affaires net", format_fcfa(summary.net_sales)),
        Row("dont espèces", format_fcfa(summary.cash_sales), detail=True),
        Row("dont Wave", format_fcfa(summary.wave_sales), detail=True),
        Row("dont Orange Money", format_fcfa(summary.orange_money_sales), detail=True),
        Row("dont mis au cahier", format_fcfa(summary.credit_sales), detail=True),
    ]
    customer_payments = (
        summary.cash_customer_payments
        + summary.wave_customer_payments
        + summary.orange_money_customer_payments
    )
    expenses = summary.cash_expenses + summary.wave_expenses + summary.orange_money_expenses
    other = [
        Row("Remboursements cahier (tous moyens)", format_fcfa(customer_payments)),
        Row(
            f"Dépenses ({summary.expenses_count})" if summary.expenses_count else "Dépenses",
            format_fcfa(expenses),
        ),
    ]

    return SessionZ(
        register=str(session.cash_register),
        cashier=session.cashier.get_full_name() or session.cashier.username,
        is_open=is_open,
        status_label=session.get_status_display(),
        opened_at=_local(session.opened_at),
        closed_at=_local(session.closed_at) if session.closed_at else None,
        duration=_duration(session.opened_at, end),
        drawer=drawer,
        expected=format_fcfa(summary.expected_cash),
        counted=format_fcfa(summary.counted_cash) if summary.counted_cash is not None else None,
        difference=_difference(summary.cash_difference),
        sales_count=summary.sales_count,
        sales=sales,
        other=other,
        report_url=(
            None if is_open else f"{settings.FRONTEND_URL}/cash-sessions/{session.pk}/report"
        ),
    )
