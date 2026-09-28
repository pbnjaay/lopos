from datetime import datetime
from decimal import Decimal, InvalidOperation
from uuid import UUID

from django.db import IntegrityError, transaction
from django.db.models import DecimalField, OuterRef, QuerySet, Subquery, Sum, Value
from django.db.models.functions import Coalesce
from django.utils import timezone

from apps.cash.exceptions import CashSessionClosed
from apps.cash.models import CashSession
from apps.sales.models import Payment
from apps.stores.models import Store

from .exceptions import (
    CustomerOverpayment,
    DuplicateCustomer,
    InvalidCustomer,
    InvalidCustomerPayment,
    InvalidLedgerEntry,
    NegativeCustomerBalance,
)
from .models import Customer, CustomerLedgerEntry, CustomerPayment
from .phone import normalize_phone

ZERO = Decimal("0.00")
_MONEY_FIELD = DecimalField(max_digits=14, decimal_places=2)


def customer_balance(customer: Customer) -> Decimal:
    """Solde dû par le client : la somme de ses écritures, rien d'autre."""
    total = CustomerLedgerEntry.objects.filter(customer_id=customer.pk).aggregate(
        total=Sum("amount")
    )["total"]
    return total if total is not None else ZERO


def with_balance(queryset: QuerySet[Customer]) -> QuerySet[Customer]:
    """Annote chaque client de son solde (`balance`), en une seule requête."""
    totals = (
        CustomerLedgerEntry.objects.filter(customer_id=OuterRef("pk"))
        .order_by()
        .values("customer_id")
        .annotate(total=Sum("amount"))
        .values("total")
    )
    return queryset.annotate(
        balance=Coalesce(
            Subquery(totals, output_field=_MONEY_FIELD),
            Value(ZERO, output_field=_MONEY_FIELD),
        )
    )


def with_book_summary(queryset: QuerySet[Customer]) -> QuerySet[Customer]:
    """Solde (`balance`) et date de la dernière écriture (`last_activity_at`,
    nulle pour un client sans historique) : ce qu'affiche la liste du cahier."""
    last_activity = (
        CustomerLedgerEntry.objects.filter(customer_id=OuterRef("pk"))
        .order_by("-occurred_at")
        .values("occurred_at")[:1]
    )
    return with_balance(queryset).annotate(last_activity_at=Subquery(last_activity))


def _normalize_amount(value) -> Decimal:
    if isinstance(value, (bool, float)) or not isinstance(value, (Decimal, int)):
        raise InvalidLedgerEntry("Le montant doit être un montant exact.")
    try:
        amount = Decimal(value).quantize(Decimal("0.01"))
    except InvalidOperation as exc:
        raise InvalidLedgerEntry("Le montant doit être un montant exact.") from exc
    if amount != Decimal(value):
        raise InvalidLedgerEntry("Le montant ne peut pas avoir plus de deux décimales.")
    return amount


def _lock_customer(customer: Customer) -> Customer:
    """Verrouille la ligne client : toute écriture qui fait baisser le solde
    passe par ce verrou, ce qui sérialise les caisses concurrentes sur un
    même cahier et rend le contrôle « solde ≥ 0 » fiable."""
    return Customer.objects.select_for_update().get(pk=customer.pk)


def _ensure_balance_stays_nonnegative(customer: Customer, delta: Decimal) -> None:
    balance = customer_balance(customer)
    if balance + delta < ZERO:
        raise NegativeCustomerBalance(
            f"Cette écriture rendrait le solde négatif (solde actuel : {balance})."
        )


@transaction.atomic
def create_customer(
    *,
    store: Store,
    name: str,
    phone: str | None,
    created_by=None,
    notes: str = "",
) -> Customer:
    """Crée un client. Le téléphone, s'il est fourni, sert de clé de
    déduplication dans le magasin — jamais le nom, qui se répète.

    Le téléphone reste facultatif ici (import, admin) : c'est l'API caisse
    qui l'exige pour une création depuis le POS.
    """
    normalized_name = " ".join((name or "").split())
    if not normalized_name:
        raise InvalidCustomer("Le nom du client est obligatoire.")

    normalized_phone = normalize_phone(phone) if phone and phone.strip() else None

    if normalized_phone is not None:
        existing = Customer.objects.filter(store=store, phone=normalized_phone).first()
        if existing is not None:
            raise DuplicateCustomer(existing)

    try:
        with transaction.atomic():
            return Customer.objects.create(
                store=store,
                name=normalized_name,
                phone=normalized_phone,
                notes=notes,
                created_by=created_by,
            )
    except IntegrityError:
        # Course entre deux caisses qui créent le même numéro au même moment.
        existing = Customer.objects.filter(store=store, phone=normalized_phone).first()
        if existing is not None:
            raise DuplicateCustomer(existing)
        raise


def record_credit_sale(*, customer: Customer, sale, amount: Decimal, created_by) -> CustomerLedgerEntry:
    """Inscrit au cahier la part non encaissée d'une vente.

    Appelé uniquement depuis la création de la vente, dans sa transaction et
    après verrouillage du client : jamais de vente à crédit sans son
    écriture, ni l'inverse. Datée comme la vente (`occurred_at`), pour qu'une
    vente hors ligne synchronisée plus tard apparaisse au bon jour.
    """
    return CustomerLedgerEntry.objects.create(
        customer=customer,
        store_id=customer.store_id,
        entry_type=CustomerLedgerEntry.EntryType.CREDIT_SALE,
        amount=amount,
        sale=sale,
        occurred_at=sale.occurred_at,
        created_by=created_by,
    )


@transaction.atomic
def record_opening_balance(
    *,
    customer: Customer,
    amount: Decimal | int,
    created_by=None,
    reference: str = "",
    reason: str = "",
    occurred_at: datetime | None = None,
) -> CustomerLedgerEntry:
    """Reprend la dette d'un ancien cahier (papier, Access) sans son historique.

    Un seul solde d'ouverture par client (contrainte en base) : rejouer une
    reprise ne double jamais une dette.
    """
    normalized = _normalize_amount(amount)
    if normalized <= ZERO:
        raise InvalidLedgerEntry("Le solde d’ouverture doit être strictement positif.")

    locked = _lock_customer(customer)
    if CustomerLedgerEntry.objects.filter(
        customer=locked, entry_type=CustomerLedgerEntry.EntryType.OPENING_BALANCE
    ).exists():
        raise InvalidLedgerEntry("Ce client a déjà un solde d’ouverture.")

    kwargs = {}
    if occurred_at is not None:
        kwargs["occurred_at"] = occurred_at
    return CustomerLedgerEntry.objects.create(
        customer=locked,
        store_id=locked.store_id,
        entry_type=CustomerLedgerEntry.EntryType.OPENING_BALANCE,
        amount=normalized,
        reference=reference,
        reason=reason,
        created_by=created_by,
        **kwargs,
    )


@transaction.atomic
def record_adjustment(
    *,
    customer: Customer,
    amount: Decimal | int,
    reason: str,
    created_by,
) -> CustomerLedgerEntry:
    """Corrige un cahier (ex. le papier dit 15 000, le logiciel 13 500).

    Réservé au gérant (admin). Le motif est obligatoire et l'écriture ne
    peut pas rendre le solde négatif.
    """
    normalized = _normalize_amount(amount)
    if normalized == ZERO:
        raise InvalidLedgerEntry("Un ajustement ne peut pas être nul.")
    normalized_reason = (reason or "").strip()
    if not normalized_reason:
        raise InvalidLedgerEntry("Le motif de l’ajustement est obligatoire.")

    locked = _lock_customer(customer)
    _ensure_balance_stays_nonnegative(locked, normalized)
    return CustomerLedgerEntry.objects.create(
        customer=locked,
        store_id=locked.store_id,
        entry_type=CustomerLedgerEntry.EntryType.ADJUSTMENT,
        amount=normalized,
        reason=normalized_reason,
        created_by=created_by,
    )


@transaction.atomic
def reverse_ledger_entry(
    *,
    entry: CustomerLedgerEntry,
    reason: str,
    created_by,
) -> CustomerLedgerEntry:
    """Annule une écriture par une écriture opposée qui la référence.

    L'écriture d'origine reste intacte (audit). Une écriture ne s'annule
    qu'une fois (`reversal_of` unique) et une annulation ne s'annule pas.
    """
    normalized_reason = (reason or "").strip()
    if not normalized_reason:
        raise InvalidLedgerEntry("Le motif de l’annulation est obligatoire.")

    locked = _lock_customer(entry.customer)
    original = CustomerLedgerEntry.objects.get(pk=entry.pk)
    if original.entry_type == CustomerLedgerEntry.EntryType.REVERSAL:
        raise InvalidLedgerEntry("Une annulation ne peut pas elle-même être annulée.")
    if CustomerLedgerEntry.objects.filter(reversal_of=original).exists():
        raise InvalidLedgerEntry("Cette écriture a déjà été annulée.")

    delta = -original.amount
    _ensure_balance_stays_nonnegative(locked, delta)
    return CustomerLedgerEntry.objects.create(
        customer=locked,
        store_id=locked.store_id,
        entry_type=CustomerLedgerEntry.EntryType.REVERSAL,
        amount=delta,
        reversal_of=original,
        reason=normalized_reason,
        created_by=created_by,
    )


def _validated_idempotent_payment(
    existing: CustomerPayment | None,
    *,
    customer: Customer,
    cash_session: CashSession,
    created_by,
) -> CustomerPayment | None:
    if existing is None:
        return None
    if (
        existing.customer_id != customer.pk
        or existing.cash_session_id != cash_session.pk
        or existing.created_by_id != created_by.pk
    ):
        raise InvalidCustomerPayment("Cette clé d’idempotence appartient à un autre paiement.")
    return existing


def _validate_repayment_method(
    *, method: str, amount: Decimal, received_amount
) -> tuple[Decimal | None, Decimal | None]:
    if method == Payment.Method.CASH:
        if isinstance(received_amount, bool) or not isinstance(received_amount, (Decimal, int)):
            raise InvalidCustomerPayment("Le montant reçu est obligatoire pour un paiement en espèces.")
        received = Decimal(received_amount)
        if received < amount:
            raise InvalidCustomerPayment("Le montant reçu est insuffisant.")
        return received, received - amount
    if method in (Payment.Method.WAVE, Payment.Method.ORANGE_MONEY):
        if received_amount is not None:
            raise InvalidCustomerPayment(
                "Le montant reçu ne doit pas être renseigné pour un paiement mobile."
            )
        return None, None
    raise InvalidCustomerPayment("Mode de paiement invalide.")


@transaction.atomic
def record_customer_payment(
    *,
    customer: Customer,
    cash_session: CashSession,
    created_by,
    method: str,
    amount: Decimal | int,
    received_amount: Decimal | int | None = None,
    idempotency_key: UUID,
) -> CustomerPayment:
    """Enregistre un remboursement client : `CustomerPayment` + écriture PAYMENT.

    - En ligne uniquement, dans une session de caisse ouverte du caissier :
      l'argent entre physiquement dans une caisse (espèces attendues pour
      CASH, simple mouvement pour Wave/OM).
    - Jamais plus que le solde dû, contrôlé sous verrou du client : deux
      caisses qui encaissent le même client en même temps sont sérialisées.
    - Idempotent : rejouer la même `idempotency_key` renvoie le paiement
      déjà enregistré, sans en créer un second.

    Ordre des verrous : session → client, comme pour une vente.
    """
    existing = _validated_idempotent_payment(
        CustomerPayment.objects.filter(idempotency_key=idempotency_key).first(),
        customer=customer,
        cash_session=cash_session,
        created_by=created_by,
    )
    if existing:
        return existing

    locked_session = (
        CashSession.objects.select_for_update()
        .select_related("cash_register")
        .get(pk=cash_session.pk)
    )
    # Relu sous verrou : un doublon concurrent a pu committer pendant l'attente.
    existing = _validated_idempotent_payment(
        CustomerPayment.objects.filter(idempotency_key=idempotency_key).first(),
        customer=customer,
        cash_session=locked_session,
        created_by=created_by,
    )
    if existing:
        return existing
    if locked_session.status != CashSession.Status.OPEN:
        raise CashSessionClosed("La session de caisse est fermée.")
    if locked_session.cashier_id != created_by.pk:
        raise InvalidCustomerPayment("Cette session appartient à un autre caissier.")
    if customer.store_id != locked_session.cash_register.store_id:
        raise InvalidCustomerPayment("Ce client appartient à un autre magasin.")

    try:
        normalized = _normalize_amount(amount)
    except InvalidLedgerEntry as exc:
        raise InvalidCustomerPayment(str(exc)) from exc
    if normalized <= ZERO:
        raise InvalidCustomerPayment("Le montant du paiement doit être strictement positif.")
    received, change = _validate_repayment_method(
        method=method, amount=normalized, received_amount=received_amount
    )

    locked_customer = _lock_customer(customer)
    balance = customer_balance(locked_customer)
    if normalized > balance:
        raise CustomerOverpayment(balance)

    now = timezone.now()
    payment = CustomerPayment.objects.create(
        customer=locked_customer,
        store_id=locked_customer.store_id,
        cash_session=locked_session,
        method=method,
        amount=normalized,
        received_amount=received,
        change_amount=change,
        balance_before=balance,
        balance_after=balance - normalized,
        idempotency_key=idempotency_key,
        created_by=created_by,
        created_at=now,
    )
    CustomerLedgerEntry.objects.create(
        customer=locked_customer,
        store_id=locked_customer.store_id,
        entry_type=CustomerLedgerEntry.EntryType.PAYMENT,
        amount=-normalized,
        customer_payment=payment,
        occurred_at=now,
        created_by=created_by,
    )
    return payment
