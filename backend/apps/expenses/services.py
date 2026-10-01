from decimal import Decimal, InvalidOperation
from uuid import UUID

from django.db import transaction
from django.utils import timezone

from apps.cash.exceptions import CashSessionClosed
from apps.cash.models import CashSession
from apps.cash.services import expected_cash_for
from apps.sales.models import Payment
from apps.stores.access import user_can_manage_store
from apps.tenancy.models import Organization

from .defaults import DEFAULT_CATEGORIES
from .exceptions import (
    ExpenseAlreadyCancelled,
    ExpenseCancellationNotAllowed,
    ExpenseNotCancellable,
    ExpenseSessionNotOwned,
    InsufficientCash,
    InvalidExpense,
)
from .models import Expense, ExpenseCategory

ZERO = Decimal("0.00")
DOCUMENT_REFERENCE_MAX_LENGTH = Expense._meta.get_field("document_reference").max_length


def ensure_default_categories(organization: Organization | None = None) -> int:
    """Crée les catégories par défaut absentes du commerce, sans toucher aux
    existantes (un gérant a pu les renommer ou les désactiver). Renvoie le
    nombre créé.

    Sans commerce précisé : celui de la base s'il n'y en a qu'un (sinon des
    catégories sans commerce, comme sur une installation neuve)."""
    if organization is None:
        organization = Organization.objects.sole()
    created_count = 0
    for position, (name, requires_description) in enumerate(DEFAULT_CATEGORIES):
        _category, created = ExpenseCategory.objects.get_or_create(
            organization=organization,
            name=name,
            defaults={
                "requires_description": requires_description,
                "sort_order": (position + 1) * 10,
            },
        )
        created_count += created
    return created_count


def _normalize_amount(value) -> Decimal:
    if isinstance(value, (bool, float)) or not isinstance(value, (Decimal, int)):
        raise InvalidExpense("Le montant doit être un montant exact.")
    try:
        amount = Decimal(value).quantize(Decimal("0.01"))
    except InvalidOperation as exc:
        raise InvalidExpense("Le montant doit être un montant exact.") from exc
    if amount != Decimal(value):
        raise InvalidExpense("Le montant ne peut pas avoir plus de deux décimales.")
    if amount <= ZERO:
        raise InvalidExpense("Le montant de la dépense doit être strictement positif.")
    return amount


def _validated_replay(
    existing: Expense | None,
    *,
    cash_session: CashSession,
    created_by,
    category: ExpenseCategory,
    amount: Decimal,
    payment_method: str,
) -> Expense | None:
    """Même clé, même dépense : on renvoie celle déjà enregistrée. Même clé,
    autre contenu : c'est un bug client, jamais une seconde dépense."""
    if existing is None:
        return None
    if (
        existing.cash_session_id != cash_session.pk
        or existing.created_by_id != created_by.pk
        or existing.category_id != category.pk
        or existing.amount != amount
        or existing.payment_method != payment_method
    ):
        raise InvalidExpense("Cette clé d’idempotence appartient à une autre dépense.")
    return existing


@transaction.atomic
def create_expense(
    *,
    cash_session: CashSession,
    created_by,
    category: ExpenseCategory,
    amount: Decimal | int,
    payment_method: str,
    description: str = "",
    document_reference: str = "",
    idempotency_key: UUID,
) -> Expense:
    """Enregistre une dépense payée depuis la session ouverte de son caissier.

    - Quel que soit le moyen de paiement, la dépense appartient à la session
      (et donc à la caisse et à la boutique) de celui qui la saisit.
    - En espèces, jamais plus que les espèces attendues dans le tiroir.
    - Idempotent : rejouer la même `idempotency_key` renvoie la dépense déjà
      enregistrée, sans en créer une seconde.

    Ordre des verrous : session d'abord, comme pour une vente ou un paiement
    client.
    """
    normalized = _normalize_amount(amount)
    if payment_method not in Payment.Method.values:
        raise InvalidExpense("Mode de paiement invalide.")

    replay = dict(
        cash_session=cash_session,
        created_by=created_by,
        category=category,
        amount=normalized,
        payment_method=payment_method,
    )
    existing = _validated_replay(
        Expense.objects.filter(idempotency_key=idempotency_key).first(), **replay
    )
    if existing:
        return existing

    locked_session = (
        CashSession.objects.select_for_update()
        .select_related("cash_register")
        .get(pk=cash_session.pk)
    )
    # Relu sous verrou : un doublon concurrent a pu committer pendant l'attente.
    existing = _validated_replay(
        Expense.objects.filter(idempotency_key=idempotency_key).first(), **replay
    )
    if existing:
        return existing
    if locked_session.status != CashSession.Status.OPEN:
        raise CashSessionClosed("La session de caisse est fermée.")
    if locked_session.cashier_id != created_by.pk:
        raise ExpenseSessionNotOwned("Cette session appartient à un autre caissier.")

    # Une catégorie d'un autre commerce est refusée comme une catégorie
    # retirée : rien ne dit qu'elle existe ailleurs.
    if not ExpenseCategory.objects.filter(
        pk=category.pk,
        is_active=True,
        organization__stores=locked_session.cash_register.store_id,
    ).exists():
        raise InvalidExpense("Cette catégorie de dépense n’est plus utilisée.")
    description = (description or "").strip()
    if category.requires_description and not description:
        raise InvalidExpense(
            f"Précisez ce qui a été payé : la description est obligatoire pour « {category.name} »."
        )
    document_reference = (document_reference or "").strip()
    if len(document_reference) > DOCUMENT_REFERENCE_MAX_LENGTH:
        raise InvalidExpense(
            f"La référence ne peut pas dépasser {DOCUMENT_REFERENCE_MAX_LENGTH} caractères."
        )

    # On ne sort pas du tiroir plus que ce qu'il contient : sous le verrou de
    # la session, aucune vente ni autre dépense ne peut changer ce montant
    # pendant le contrôle. Sans ce garde-fou, la clôture échouerait sur la
    # contrainte « solde attendu positif ou nul ».
    if payment_method == Payment.Method.CASH:
        available = expected_cash_for(locked_session)
        if normalized > available:
            raise InsufficientCash(available)

    now = timezone.now()
    return Expense.objects.create(
        store_id=locked_session.cash_register.store_id,
        cash_session=locked_session,
        category=category,
        amount=normalized,
        payment_method=payment_method,
        description=description,
        document_reference=document_reference,
        occurred_at=now,
        created_at=now,
        created_by=created_by,
        idempotency_key=idempotency_key,
    )


@transaction.atomic
def cancel_expense(*, expense: Expense, cancelled_by, reason: str) -> Expense:
    """Annule une dépense : elle reste visible, mais ne compte plus nulle part.

    Possible seulement tant que sa session est ouverte : le rapport Z d'une
    session clôturée ne change jamais après coup. Le caissier annule ses
    propres dépenses, un propriétaire ou un gérant du magasin toutes.

    Ordre des verrous : session → dépense.
    """
    reason = (reason or "").strip()
    if not reason:
        raise InvalidExpense("Le motif de l’annulation est obligatoire.")

    if expense.cash_session_id is not None:
        locked_session = CashSession.objects.select_for_update().get(
            pk=expense.cash_session_id
        )
    else:
        locked_session = None
    locked = Expense.objects.select_for_update().get(pk=expense.pk)

    if locked.status == Expense.Status.CANCELLED:
        raise ExpenseAlreadyCancelled("Cette dépense est déjà annulée.")
    if locked.created_by_id != cancelled_by.pk and not user_can_manage_store(
        cancelled_by, locked.store_id
    ):
        raise ExpenseCancellationNotAllowed(
            "Cette dépense a été saisie par un autre utilisateur."
        )
    if locked_session is not None and locked_session.status != CashSession.Status.OPEN:
        raise ExpenseNotCancellable("La session de caisse de cette dépense est clôturée.")

    locked.status = Expense.Status.CANCELLED
    locked.cancelled_at = timezone.now()
    locked.cancelled_by = cancelled_by
    locked.cancellation_reason = reason
    locked.save(update_fields=tuple(Expense.CANCELLATION_FIELDS))
    return locked
