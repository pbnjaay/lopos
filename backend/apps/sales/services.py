from collections.abc import Sequence
from datetime import datetime
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import NamedTuple, TypedDict
from uuid import UUID, uuid4

from django.db import models, transaction

from apps.cash.exceptions import CashSessionClosed
from apps.observability.sentry_context import tag_sale_scope
from apps.cash.models import CashSession
from apps.catalog.models import Product
from apps.inventory.models import InventoryMovement, Stock

from .exceptions import (
    InsufficientStock,
    InvalidPayment,
    InvalidSaleItems,
    ProductInactive,
    ProductNotFound,
    InvalidReturn,
)
from .models import Payment, Sale, SaleItem, SaleReturn, SaleReturnItem


class SaleItemInput(TypedDict):
    product_id: UUID
    quantity: Decimal
    unit_price: Decimal | None


class OfflineSaleItemInput(TypedDict):
    product_id: UUID
    product_name: str
    unit_price: Decimal
    catalog_unit_price: Decimal | None
    quantity: Decimal


class _LineSpec(NamedTuple):
    product: Product
    quantity: Decimal
    unit_price: Decimal
    catalog_unit_price: Decimal
    product_name: str


def _normalize_quantity(value, *, product: Product | None = None) -> Decimal:
    try:
        quantity = Decimal(value)
    except (InvalidOperation, TypeError, ValueError):
        raise InvalidSaleItems("La quantité vendue doit être un décimal positif.")
    if quantity <= 0 or quantity.as_tuple().exponent < -3:
        raise InvalidSaleItems("La quantité vendue doit être positive, avec au plus 3 décimales.")
    quantity = quantity.quantize(Decimal("0.001"))
    if product is not None and product.sale_unit == Product.SaleUnit.UNIT and quantity != quantity.to_integral_value():
        raise InvalidSaleItems(f"La quantité de {product.name} doit être entière.")
    return quantity


def _normalize_price(value) -> Decimal:
    try:
        price = Decimal(value).quantize(Decimal("0.01"))
    except (InvalidOperation, TypeError, ValueError):
        raise InvalidSaleItems("Le prix unitaire doit être un montant valide.")
    if price <= 0:
        raise InvalidSaleItems("Le prix unitaire doit être strictement positif.")
    return price


def _money(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _aggregate_items(items: Sequence[SaleItemInput]) -> dict[UUID, tuple[Decimal, Decimal | None]]:
    if not items:
        raise InvalidSaleItems("Une vente doit contenir au moins un article.")

    quantities: dict[UUID, tuple[Decimal, Decimal | None]] = {}
    for item in items:
        try:
            product_id = item["product_id"]
            quantity = item["quantity"]
            unit_price = item.get("unit_price")
        except (KeyError, TypeError) as exc:
            raise InvalidSaleItems(
                "Chaque article doit avoir un produit et une quantité."
            ) from exc

        if not isinstance(product_id, UUID):
            raise InvalidSaleItems("L'identifiant produit doit être un UUID.")
        quantity = _normalize_quantity(quantity)
        override = _normalize_price(unit_price) if unit_price is not None else None
        existing = quantities.get(product_id)
        if existing and existing[1] != override:
            raise InvalidSaleItems("Un même produit ne peut pas avoir deux prix dans une vente.")
        quantities[product_id] = ((existing[0] if existing else Decimal("0")) + quantity, override)

    return quantities


def _aggregate_offline_items(
    items: Sequence[OfflineSaleItemInput],
) -> dict[UUID, tuple[Decimal, Decimal, str, Decimal | None]]:
    if not items:
        raise InvalidSaleItems("Une vente doit contenir au moins un article.")

    aggregated: dict[UUID, tuple[Decimal, Decimal, str, Decimal | None]] = {}
    for item in items:
        try:
            product_id = item["product_id"]
            quantity = item["quantity"]
            unit_price = item["unit_price"]
            product_name = item["product_name"]
            catalog_unit_price = item.get("catalog_unit_price")
        except (KeyError, TypeError) as exc:
            raise InvalidSaleItems(
                "Chaque article doit avoir un produit, un prix et une quantité."
            ) from exc

        if not isinstance(product_id, UUID):
            raise InvalidSaleItems("L'identifiant produit doit être un UUID.")
        quantity = _normalize_quantity(quantity)
        unit_price = _normalize_price(unit_price)
        catalog_unit_price = _normalize_price(catalog_unit_price) if catalog_unit_price is not None else None

        existing = aggregated.get(product_id)
        if existing is None:
            aggregated[product_id] = (quantity, unit_price, product_name, catalog_unit_price)
        else:
            existing_quantity, existing_price, existing_name, existing_catalog_price = existing
            if existing_price != unit_price:
                raise InvalidSaleItems("Un même produit ne peut pas avoir deux prix dans une vente.")
            if existing_catalog_price != catalog_unit_price:
                raise InvalidSaleItems("Un même produit ne peut pas avoir deux prix catalogue dans une vente.")
            aggregated[product_id] = (
                existing_quantity + quantity,
                existing_price,
                existing_name,
                existing_catalog_price,
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
    tag_sale_scope(
        sale_id=sale_id,
        cash_session_id=locked_session.id,
        payment_method=payment_method,
        offline=allow_negative_stock,
    )

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
        (spec.product, spec.quantity, spec.unit_price, spec.catalog_unit_price, spec.product_name)
        for spec in line_specs
    ]
    subtotal = sum(
        (_money(unit_price * quantity) for _, quantity, unit_price, _, _ in line_values),
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
                sale_unit=product.sale_unit,
                catalog_unit_price=catalog_unit_price,
                unit_price=unit_price,
                quantity=quantity,
                line_total=_money(unit_price * quantity),
            )
            for product, quantity, unit_price, catalog_unit_price, product_name in line_values
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
        _normalize_quantity(quantities[product_id][0], product=product)

    line_specs = [
        _LineSpec(
            product=products[product_id],
            quantity=quantities[product_id][0],
            unit_price=_normalize_price(quantities[product_id][1] or products[product_id].selling_price),
            catalog_unit_price=products[product_id].selling_price,
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
        _normalize_quantity(aggregated[product_id][0], product=products[product_id])

    line_specs = [
        _LineSpec(
            product=products[product_id],
            quantity=aggregated[product_id][0],
            unit_price=aggregated[product_id][1],
            catalog_unit_price=aggregated[product_id][3] or products[product_id].selling_price,
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


class ReturnItemInput(TypedDict):
    sale_item_id: UUID
    quantity: Decimal
    restock: bool


@transaction.atomic
def create_sale_return(
    *, original_sale: Sale, cash_session: CashSession, created_by,
    payment_method: str, items: Sequence[ReturnItemInput], idempotency_key: UUID,
) -> SaleReturn:
    existing = SaleReturn.objects.filter(idempotency_key=idempotency_key).first()
    if existing:
        return existing
    if not items:
        raise InvalidReturn("Sélectionnez au moins un article à retourner.")
    locked_session = CashSession.objects.select_for_update().select_related("cash_register").get(pk=cash_session.pk)
    existing = SaleReturn.objects.filter(idempotency_key=idempotency_key).first()
    if existing:
        return existing
    if locked_session.status != CashSession.Status.OPEN:
        raise CashSessionClosed("La session de caisse est fermée.")
    if locked_session.cashier_id != created_by.pk:
        raise InvalidReturn("Cette session appartient à un autre caissier.")
    sale = Sale.objects.select_for_update().get(pk=original_sale.pk)
    if sale.status != Sale.Status.COMPLETED:
        raise InvalidReturn("Seule une vente terminée peut être retournée.")
    if sale.cash_session.cash_register.store_id != locked_session.cash_register.store_id:
        raise InvalidReturn("Le retour doit être effectué dans le magasin de la vente.")
    if payment_method not in Payment.Method.values:
        raise InvalidReturn("Mode de remboursement invalide.")

    requested: dict[UUID, tuple[Decimal, bool]] = {}
    for raw in items:
        item_id = raw["sale_item_id"]
        if item_id in requested:
            raise InvalidReturn("Un article ne peut apparaître qu’une fois dans un retour.")
        try:
            quantity = _normalize_quantity(raw["quantity"])
        except InvalidSaleItems as exc:
            raise InvalidReturn(str(exc)) from exc
        requested[item_id] = (quantity, bool(raw["restock"]))

    locked_items = {
        item.id: item for item in SaleItem.objects.select_for_update().filter(
            sale=sale, id__in=requested
        ).select_related("product")
    }
    if len(locked_items) != len(requested):
        raise InvalidReturn("Un article ne fait pas partie de cette vente.")

    specs = []
    total = Decimal("0.00")
    for item_id, (quantity, restock) in requested.items():
        item = locked_items[item_id]
        try:
            _normalize_quantity(quantity, product=item.product)
        except InvalidSaleItems as exc:
            raise InvalidReturn(str(exc)) from exc
        already = SaleReturnItem.objects.filter(
            original_sale_item=item, sale_return__status=SaleReturn.Status.COMPLETED
        ).aggregate(total=models.Sum("quantity"))["total"] or Decimal("0.000")
        if quantity > item.quantity - already:
            raise InvalidReturn(f"La quantité retournée dépasse le reste disponible pour {item.product_name}.")
        refund = _money(item.unit_price * quantity)
        total += refund
        specs.append((item, quantity, restock, refund))

    sale_return = SaleReturn.objects.create(
        original_sale=sale, cash_session=locked_session, created_by=created_by,
        total_refund=total, payment_method=payment_method,
        idempotency_key=idempotency_key,
    )
    SaleReturnItem.objects.bulk_create([
        SaleReturnItem(sale_return=sale_return, original_sale_item=item,
                       quantity=quantity, unit_price=item.unit_price,
                       refund_amount=refund, restock=restock)
        for item, quantity, restock, refund in specs
    ])
    store_id = locked_session.cash_register.store_id
    for item, quantity, restock, _ in specs:
        if not restock:
            continue
        stock, _ = Stock.objects.select_for_update().get_or_create(
            store_id=store_id, product_id=item.product_id,
            defaults={"quantity": Decimal("0.000")},
        )
        stock.quantity += quantity
        stock.save(update_fields=("quantity", "updated_at"))
        InventoryMovement.objects.create(
            store_id=store_id, product_id=item.product_id,
            movement_type=InventoryMovement.Type.RETURN_IN,
            quantity=quantity, reference=sale_return.id,
        )
    return sale_return
