from uuid import UUID

from django.db.models import QuerySet

from apps.cash.models import CashSession
from apps.tenancy.context import resolve_tenant
from apps.tenancy.scoping import scope

from .models import Sale, SaleReturn


def get_pos_cash_session(
    *, user, cash_session_id: UUID | None = None
) -> CashSession | None:
    """Return the caller's open POS session, without any staff bypass, in a
    store the caller still has access to."""

    queryset = (
        scope(CashSession.objects, resolve_tenant(user))
        .select_related("cash_register__store")
        .filter(
            cashier=user,
            status=CashSession.Status.OPEN,
        )
    )
    if cash_session_id is not None:
        return queryset.filter(pk=cash_session_id).first()

    sessions = list(queryset[:2])
    return sessions[0] if len(sessions) == 1 else None


def sales_for_pos_session(*, cash_session: CashSession) -> QuerySet[Sale]:
    """Scope POS sales to the single store in which the session is open."""

    return Sale.objects.filter(
        cash_session__cash_register__store_id=cash_session.cash_register.store_id
    )


def returns_for_pos_session(*, cash_session: CashSession) -> QuerySet[SaleReturn]:
    return SaleReturn.objects.filter(
        original_sale__cash_session__cash_register__store_id=(
            cash_session.cash_register.store_id
        )
    )
