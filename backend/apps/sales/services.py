from collections.abc import Sequence
from datetime import datetime
from decimal import Decimal
from typing import NamedTuple, TypedDict
from uuid import UUID, uuid4

from django.db import transaction

from apps.cash.exceptions import CashSessionClosed
from apps.cash.models import CashSession
from apps.catalog.models import Product
from apps.inventory.models import InventoryMovement, Stock

from .exceptions import (
    InsufficientStock,
    InvalidPayment,
    InvalidSaleItems,
    ProductInactive,
    ProductNotFound,
)
from .models import Payment, Sale, SaleItem


class SaleItemInput(TypedDict):
    product_id: UUID
    quantity: int


class OfflineSaleItemInput(TypedDict):
    product_id: UUID
    product_name: str
    unit_price: Decimal
    quantity: int


class _LineSpec(NamedTuple):
    product: Product
    quantity: int
    unit_price: Decimal
    product_name: str


def _aggregate_items(items: Sequence[SaleItemInput]) -> dict[UUID, int]:
    if not items:
        raise InvalidSaleItems("Une vente doit contenir au moins un article.")

    quantities: dict[UUID, int] = {}
    for item in items:
        try:
            product_id = item["product_id"]
            quantity = item["quantity"]
        except (KeyError, TypeError) as exc:
            raise InvalidSaleItems(
                "Chaque article doit avoir un produit et une quantité."
            ) from exc

        if not isinstance(product_id, UUID):
            raise InvalidSaleItems("L'identifiant produit doit être un UUID.")
        if isinstance(quantity, bool) or not isinstance(quantity, int) or quantity <= 0:
            raise InvalidSaleItems("La quantité vendue doit être un entier positif.")

        quantities[product_id] = quantities.get(product_id, 0) + quantity

    return quantities


def _aggregate_offline_items(
    items: Sequence[OfflineSaleItemInput],
) -> dict[UUID, tuple[int, Decimal, str]]:
    if not items:
        raise InvalidSaleItems("Une vente doit contenir au moins un article.")

    aggregated: dict[UUID, tuple[int, Decimal, str]] = {}
    for item in items:
        try:
            product_id = item["product_id"]
            quantity = item["quantity"]
            unit_price = item["unit_price"]
            product_name = item["product_name"]
        except (KeyError, TypeError) as exc:
            raise InvalidSaleItems(
                "Chaque article doit avoir un produit, un prix et une quantité."
            ) from exc

        if not isinstance(product_id, UUID):
            raise InvalidSaleItems("L'identifiant produit doit être un UUID.")
        if isinstance(quantity, bool) or not isinstance(quantity, int) or quantity <= 0:
            raise InvalidSaleItems("La quantité vendue doit être un entier positif.")
        if not isinstance(unit_price, Decimal) or unit_price < 0:
            raise InvalidSaleItems("Le prix unitaire doit être un décimal positif.")

        existing = aggregated.get(product_id)
        if existing is None:
            aggregated[product_id] = (quantity, unit_price, product_name)
        else:
            existing_quantity, existing_price, existing_name = existing
            # Le prix figé au moment de la vente hors-ligne fait foi : on garde
            # celui de la première ligne rencontrée pour ce produit.
            aggregated[product_id] = (
                existing_quantity + quantity,
                existing_price,
                existing_name,
            )

    return aggregated


def _validate_payment(
    *,
    method: str,
    total: Decimal,
    received_amount: Decimal | int | None,
) -> tuple[Decimal | None, Decimal | None]:
    if method == Payment.Method.CASH:
        if isinstance(received_amount, bool) or not isinstance(
            received_amount, (Decimal, int)
        ):
            raise InvalidPayment("Le montant reçu est obligatoire pour un paiement cash.")

        normalized_received = Decimal(received_amount)
        if normalized_received < total:
            raise InvalidPayment("Le montant reçu est insuffisant.")
        return normalized_received, normalized_received - total

    if method in (Payment.Method.WAVE, Payment.Method.ORANGE_MONEY):
        if received_amount is not None:
            raise InvalidPayment(
                "Le montant reçu ne doit pas être renseigné pour un paiement mobile."
            )
        return None, None

    raise InvalidPayment("Méthode de paiement invalide.")


def _execute_sale(
    *,
    sale_id: UUID,
    locked_session: CashSession,
    line_specs: Sequence[_LineSpec],
    payment_method: str,
    received_amount: Decimal | int | None,
    occurred_at: datetime | None,
    allow_negative_stock: bool,
) -> tuple[Sale, bool]:
    """Crée une vente complète (Sale/SaleItem/Payment/InventoryMovement).

    Partagé par le chemin online (`complete_sale`) et le chemin de
    synchronisation offline (`complete_offline_sale`). `allow_negative_stock`
    distingue les deux : une vente en ligne ne peut jamais faire passer le
    stock sous zéro (le stock est la vérité au moment de l'encaissement),
    tandis qu'une vente hors-ligne a déjà eu lieu physiquement et doit être
    acceptée même si le stock serveur ne peut plus la couvrir — dans ce cas
    le stock devient négatif et l'appelant en est informé (booléen retourné)
    afin de tracer la divergence.
    """
    store_id = locked_session.cash_register.store_id
    product_ids = sorted({spec.product.id for spec in line_specs})

    stocks_by_product = {
        stock.product_id: stock
        for stock in Stock.objects.select_for_update()
        .filter(store_id=store_id, product_id__in=product_ids)
        .order_by("product_id")
    }

    stock_discrepancy = False
    for spec in line_specs:
        stock = stocks_by_product.get(spec.product.id)
        if stock is None:
            stock = Stock.objects.create(
                store_id=store_id, product_id=spec.product.id, quantity=0
            )
            stocks_by_product[spec.product.id] = stock

        available = stock.quantity
        if available < spec.quantity:
            if not allow_negative_stock:
                raise InsufficientStock(
                    product_name=spec.product_name,
                    requested=spec.quantity,
                    available=available,
                )
            stock_discrepancy = True

    line_values = [
        (spec.product, spec.quantity, spec.unit_price, spec.product_name)
        for spec in line_specs
    ]
    subtotal = sum(
        (unit_price * quantity for _, quantity, unit_price, _ in line_values),
        Decimal("0.00"),
    )
    discount = Decimal("0.00")
    total = subtotal

    normalized_received, change_amount = _validate_payment(
        method=payment_method,
        total=total,
        received_amount=received_amount,
    )

    sale_kwargs = dict(
        id=sale_id,
        cash_session=locked_session,
        cashier=locked_session.cashier,
        subtotal=subtotal,
        discount=discount,
        total=total,
        status=Sale.Status.COMPLETED,
    )
    if occurred_at is not None:
        sale_kwargs["occurred_at"] = occurred_at
    sale = Sale.objects.create(**sale_kwargs)

    SaleItem.objects.bulk_create(
        [
            SaleItem(
                sale=sale,
                product=product,
                product_name=product_name,
                unit_price=unit_price,
                quantity=quantity,
                line_total=unit_price * quantity,
            )
            for product, quantity, unit_price, product_name in line_values
        ]
    )

    Payment.objects.create(
        sale=sale,
        method=payment_method,
        amount=total,
        received_amount=normalized_received,
        change_amount=change_amount,
    )

    for spec in line_specs:
        stock = stocks_by_product[spec.product.id]
        stock.quantity -= spec.quantity
        stock.save(update_fields=("quantity", "updated_at"))

    InventoryMovement.objects.bulk_create(
        [
            InventoryMovement(
                store_id=store_id,
                product_id=spec.product.id,
                movement_type=InventoryMovement.Type.SALE,
                quantity=-spec.quantity,
                reference=sale.id,
            )
            for spec in line_specs
        ]
    )

    return sale, stock_discrepancy


@transaction.atomic
def complete_sale(
    *,
    cash_session: CashSession,
    items: Sequence[SaleItemInput],
    payment_method: str,
    received_amount: Decimal | int | None = None,
) -> Sale:
    quantities = _aggregate_items(items)
    product_ids = sorted(quantities)

    locked_session = (
        CashSession.objects.select_for_update()
        .select_related("cash_register", "cashier")
        .get(pk=cash_session.pk)
    )
    if locked_session.status != CashSession.Status.OPEN:
        raise CashSessionClosed("La session de caisse est fermée.")

    products = {
        product.id: product
        for product in Product.objects.filter(id__in=product_ids).order_by("id")
    }
    for product_id in product_ids:
        product = products.get(product_id)
        if product is None:
            raise ProductNotFound(product_id)
        if not product.is_active:
            raise ProductInactive(product.name)

    line_specs = [
        _LineSpec(
            product=products[product_id],
            quantity=quantities[product_id],
            unit_price=products[product_id].selling_price,
            product_name=products[product_id].name,
        )
        for product_id in product_ids
    ]

    sale, _ = _execute_sale(
        sale_id=uuid4(),
        locked_session=locked_session,
        line_specs=line_specs,
        payment_method=payment_method,
        received_amount=received_amount,
        occurred_at=None,
        allow_negative_stock=False,
    )
    return sale


@transaction.atomic
def complete_offline_sale(
    *,
    sale_id: UUID,
    cash_session: CashSession,
    items: Sequence[OfflineSaleItemInput],
    payment_method: str,
    received_amount: Decimal | int | None,
    occurred_at: datetime,
) -> tuple[Sale, bool]:
    """Rejoue une vente réalisée hors-ligne, telle que capturée par le POS.

    Différences volontaires avec `complete_sale` (vente en ligne) :
    - `sale_id` est fourni par le client (identité définitive côté POS avant
      même d'atteindre Django) et devient la PK de `Sale` ;
    - le prix unitaire est celui figé localement au moment de la vente
      (`unit_price` du payload), jamais le prix catalogue courant — le prix
      hors-ligne fait foi, cf. décision produit Phase F ;
    - un produit désactivé depuis la vente reste accepté s'il existe encore
      (il existait bien au moment de la vente réelle) ; seul un produit
      supprimé du catalogue est rejeté ;
    - le stock peut devenir négatif (`allow_negative_stock=True`) : la vente
      a déjà eu lieu physiquement, la refuser des heures plus tard serait
      pire qu'une divergence de stock. Le booléen retourné indique si une
      divergence a été introduite, pour audit.
    """
    aggregated = _aggregate_offline_items(items)
    product_ids = sorted(aggregated)

    locked_session = (
        CashSession.objects.select_for_update()
        .select_related("cash_register", "cashier")
        .get(pk=cash_session.pk)
    )
    if locked_session.status == CashSession.Status.CLOSED and (
        locked_session.closed_at is None or occurred_at > locked_session.closed_at
    ):
        raise CashSessionClosed(
            "La session de caisse a été clôturée avant cette vente."
        )

    products = {
        product.id: product
        for product in Product.objects.filter(id__in=product_ids).order_by("id")
    }
    for product_id in product_ids:
        if product_id not in products:
            raise ProductNotFound(product_id)

    line_specs = [
        _LineSpec(
            product=products[product_id],
            quantity=aggregated[product_id][0],
            unit_price=aggregated[product_id][1],
            product_name=aggregated[product_id][2],
        )
        for product_id in product_ids
    ]

    return _execute_sale(
        sale_id=sale_id,
        locked_session=locked_session,
        line_specs=line_specs,
        payment_method=payment_method,
        received_amount=received_amount,
        occurred_at=occurred_at,
        allow_negative_stock=True,
    )
