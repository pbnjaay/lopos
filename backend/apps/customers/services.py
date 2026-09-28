from datetime import datetime
from decimal import Decimal, InvalidOperation

from django.db import IntegrityError, transaction
from django.db.models import DecimalField, OuterRef, QuerySet, Subquery, Sum, Value
from django.db.models.functions import Coalesce

from apps.stores.models import Store

from .exceptions import (
    DuplicateCustomer,
    InvalidCustomer,
    InvalidLedgerEntry,
    NegativeCustomerBalance,
)
from .models import Customer, CustomerLedgerEntry
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
