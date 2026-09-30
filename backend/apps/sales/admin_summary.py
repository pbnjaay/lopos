"""Fiche d'une vente dans l'admin, lue comme le ticket imprimé au POS.

Prépare les données déjà formatées (montants, quantités) pour le template
`admin/sales/sale_summary.html` : le template n'a plus qu'à les placer.
"""

from dataclasses import dataclass, field
from decimal import Decimal

from django.conf import settings
from django.urls import reverse
from django.utils import timezone

from apps.dashboard.formatting import format_fcfa, format_quantity

from .models import Payment, Sale, SaleReturn


@dataclass(frozen=True, slots=True)
class TicketLine:
    name: str
    quantity: str
    unit_price: str
    # Prix catalogue, seulement quand le prix a été modifié à la caisse.
    catalog_price: str | None
    total: str
    returned: str | None


@dataclass(frozen=True, slots=True)
class TicketPayment:
    method: str
    amount: str
    detail: str | None


@dataclass(frozen=True, slots=True)
class TicketReturn:
    reference: str
    date: str
    amount: str
    url: str


@dataclass(frozen=True, slots=True)
class SaleTicket:
    reference: str
    status: str
    status_label: str
    occurred_at: str
    register: str
    cashier: str
    total: str
    net_total: str | None
    lines: list[TicketLine] = field(default_factory=list)
    payments: list[TicketPayment] = field(default_factory=list)
    credit_amount: str | None = None
    customer_name: str | None = None
    customer_url: str | None = None
    returns: list[TicketReturn] = field(default_factory=list)
    session_url: str = ""
    print_url: str = ""


def _local(value) -> str:
    return timezone.localtime(value).strftime("%d/%m/%Y à %H:%M")


def build_sale_ticket(sale: Sale) -> SaleTicket:
    lines = []
    for item in sale.items.all():
        returned = item.quantity_returned
        lines.append(
            TicketLine(
                name=item.product_name,
                quantity=format_quantity(item.quantity, item.sale_unit),
                unit_price=format_fcfa(item.unit_price),
                catalog_price=(
                    format_fcfa(item.catalog_unit_price)
                    if item.catalog_unit_price and item.catalog_unit_price != item.unit_price
                    else None
                ),
                total=format_fcfa(item.line_total),
                returned=format_quantity(returned, item.sale_unit) if returned else None,
            )
        )

    payments = []
    for payment in sale.payments.all():
        detail = None
        if payment.method == Payment.Method.CASH and payment.change_amount:
            detail = (
                f"Reçu {format_fcfa(payment.received_amount)} · "
                f"rendu {format_fcfa(payment.change_amount)}"
            )
        payments.append(
            TicketPayment(
                method=payment.get_method_display(),
                amount=format_fcfa(payment.amount),
                detail=detail,
            )
        )

    completed_returns = list(
        sale.returns.filter(status=SaleReturn.Status.COMPLETED).order_by("created_at")
    )
    returns = [
        TicketReturn(
            reference=sale_return.reference,
            date=_local(sale_return.created_at),
            amount=format_fcfa(sale_return.total_refund),
            url=reverse("admin:sales_salereturn_change", args=[sale_return.pk]),
        )
        for sale_return in completed_returns
    ]
    returned_total = sum((r.total_refund for r in completed_returns), Decimal("0"))

    return SaleTicket(
        reference=sale.reference,
        status=sale.status,
        status_label=sale.get_status_display(),
        occurred_at=_local(sale.occurred_at),
        register=str(sale.cash_session.cash_register),
        cashier=sale.cashier.get_full_name() or sale.cashier.username,
        total=format_fcfa(sale.total),
        net_total=format_fcfa(sale.total - returned_total) if returns else None,
        lines=lines,
        payments=payments,
        credit_amount=format_fcfa(sale.credit_amount) if sale.credit_amount else None,
        customer_name=sale.customer.name if sale.customer else None,
        customer_url=(
            reverse("admin:customers_customer_change", args=[sale.customer_id])
            if sale.customer_id
            else None
        ),
        returns=returns,
        session_url=reverse("admin:cash_cashsession_change", args=[sale.cash_session_id]),
        print_url=f"{settings.FRONTEND_URL}/sales/{sale.pk}/receipt",
    )
