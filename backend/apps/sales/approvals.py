"""Validation par un gérant des opérations sensibles d'un caissier.

Annuler une vente, faire un retour ou accorder une remise au-delà des seuils
(`settings.APPROVAL_*`) exige qu'un gérant du magasin ou le propriétaire
tape son code PIN sur le poste du caissier. Le serveur vérifie le PIN et
rend une validation signée (`issue`), liée à la session, à l'opération et à
la vente ; l'opération la présente ensuite (`verify`). Le PIN ne quitte
jamais le serveur et la validation ne peut servir à rien d'autre.

Un compte qui gère lui-même le magasin (propriétaire, gérant affecté) n'a
jamais besoin de validation.
"""

from datetime import UTC, datetime, timedelta
from decimal import Decimal

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core import signing
from django.core.cache import cache
from django.db import models
from django.utils import timezone

from apps.stores.access import user_can_manage_store
from apps.tenancy.models import OrganizationMembership

User = get_user_model()
Role = OrganizationMembership.Role

_SALT = "lopos.sales.approval"

PIN_MAX_FAILURES = 5
PIN_FAILURE_WINDOW_SECONDS = 15 * 60


class Action(models.TextChoices):
    CANCEL_SALE = "CANCEL_SALE", "Annulation de vente"
    SALE_RETURN = "SALE_RETURN", "Retour"
    DISCOUNT = "DISCOUNT", "Remise"


class ApprovalRequired(Exception):
    """L'opération dépasse ce qu'un caissier fait seul : un gérant doit la
    valider (ou la validation fournie n'est pas valable)."""


class InvalidApprovalPin(Exception):
    pass


class ApprovalPinLocked(Exception):
    pass


def threshold() -> Decimal:
    return settings.APPROVAL_AMOUNT_THRESHOLD


def approvers_for_store(store) -> models.QuerySet:
    """Comptes qui peuvent valider dans ce magasin : propriétaire, ou gérant
    qui y est affecté — actifs, membres actifs, avec un code PIN."""
    memberships = OrganizationMembership.objects.filter(
        organization_id=store.organization_id,
        is_active=True,
        user__is_active=True,
        user__is_superuser=False,
    ).exclude(approval_pin="")
    owners = memberships.filter(role=Role.OWNER).values("user_id")
    managers = memberships.filter(
        role=Role.MANAGER,
        user__store_assignments__store=store,
        user__store_assignments__is_active=True,
    ).values("user_id")
    return User.objects.filter(
        models.Q(pk__in=owners) | models.Q(pk__in=managers)
    ).order_by("first_name", "username")


def needs_approval(user, store_id) -> bool:
    return not user_can_manage_store(user, store_id)


def _pin_failure_key(approver_id) -> str:
    return f"approval-pin-failures:{approver_id}"


def check_pin(*, store, approver_id, pin: str):
    """Le compte validant si son PIN est bon. Cinq erreurs en 15 minutes
    suspendent ses validations le temps de la fenêtre (jamais au-delà)."""
    key = _pin_failure_key(approver_id)
    if (cache.get(key) or 0) >= PIN_MAX_FAILURES:
        raise ApprovalPinLocked("Trop d'essais de code PIN. Réessayez dans quelques minutes.")
    approver = approvers_for_store(store).filter(pk=approver_id).first()
    membership = (
        OrganizationMembership.objects.filter(user=approver, is_active=True).first()
        if approver
        else None
    )
    if membership is None or not membership.check_approval_pin(pin or ""):
        cache.set(key, (cache.get(key) or 0) + 1, PIN_FAILURE_WINDOW_SECONDS)
        raise InvalidApprovalPin("Code PIN incorrect.")
    cache.delete(key)
    return approver


def issue(*, approver, cash_session, action: str, sale_id) -> str:
    return signing.dumps(
        {
            "approver": approver.pk,
            "session": str(cash_session.pk),
            "action": action,
            "sale": str(sale_id),
            "iat": timezone.now().timestamp(),
        },
        salt=_SALT,
    )


def verify(token, *, cash_session, action: str, sale_id, at: datetime | None = None):
    """Le compte qui a validé, ou None : signature, session, opération et
    vente doivent correspondre, la validation dater d'au plus
    `APPROVAL_TOKEN_MAX_AGE_SECONDS` avant `at` (maintenant, ou l'heure de la
    vente hors ligne), et son auteur pouvoir encore valider dans ce magasin."""
    if not token:
        return None
    try:
        data = signing.loads(token, salt=_SALT)
    except signing.BadSignature:
        return None
    if (
        data.get("session") != str(cash_session.pk)
        or data.get("action") != action
        or data.get("sale") != str(sale_id)
    ):
        return None
    issued_at = datetime.fromtimestamp(float(data.get("iat", 0)), tz=UTC)
    reference = at or timezone.now()
    max_age = timedelta(seconds=settings.APPROVAL_TOKEN_MAX_AGE_SECONDS)
    # Une minute d'avance tolérée : l'horloge du poste n'est pas exacte.
    if not (reference - max_age <= issued_at <= reference + timedelta(minutes=1)):
        return None
    store = cash_session.cash_register.store
    return approvers_for_store(store).filter(pk=data.get("approver")).first()


def require(user, *, cash_session, action: str, sale_id, token, needed: bool):
    """Le compte validant si l'opération en exige un, None sinon ; lève
    `ApprovalRequired` s'il en faut un et que `token` n'est pas valable."""
    store_id = cash_session.cash_register.store_id
    if not needed or not needs_approval(user, store_id):
        return None
    approver = verify(token, cash_session=cash_session, action=action, sale_id=sale_id)
    if approver is None:
        raise ApprovalRequired("Cette opération doit être validée par un gérant.")
    return approver


# --- Règles ---------------------------------------------------------------


def cancellation_needs_approval(sale) -> bool:
    return sale.total >= threshold()


def return_needs_approval(*, sale, refund_total: Decimal, now: datetime | None = None) -> bool:
    window = timedelta(days=settings.APPROVAL_RETURN_WINDOW_DAYS)
    too_old = sale.occurred_at < (now or timezone.now()) - window
    return refund_total >= threshold() or too_old


def discount_needs_approval(lines) -> bool:
    """`lines` : (prix catalogue, prix pratiqué, quantité). Une hausse de
    prix n'est pas une remise."""
    total_discount = Decimal("0")
    for catalog_price, unit_price, quantity in lines:
        if not catalog_price or unit_price >= catalog_price:
            continue
        if (catalog_price - unit_price) / catalog_price > settings.APPROVAL_MAX_DISCOUNT_RATE:
            return True
        total_discount += (catalog_price - unit_price) * quantity
    return total_discount >= threshold()
