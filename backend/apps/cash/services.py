from decimal import Decimal

from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction

from apps.stores.models import CashRegister

from .exceptions import (
    CashRegisterInactive,
    CashSessionAlreadyOpen,
    InvalidOpeningBalance,
)
from .models import CashSession


User = get_user_model()


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
