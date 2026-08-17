from collections.abc import Sequence
from decimal import Decimal
from typing import TypedDict
from uuid import UUID

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

    store_id = locked_session.cash_register.store_id
    stocks = list(
        Stock.objects.select_for_update()
        .filter(store_id=store_id, product_id__in=product_ids)
        .order_by("product_id")
    )
    stocks_by_product = {stock.product_id: stock for stock in stocks}

    for product_id in product_ids:
        stock = stocks_by_product.get(product_id)
        available = stock.quantity if stock is not None else 0
        requested = quantities[product_id]
        if available < requested:
            raise InsufficientStock(
                product_name=products[product_id].name,
                requested=requested,
                available=available,
            )

    line_values = [
        (
            products[product_id],
            quantities[product_id],
            products[product_id].selling_price * quantities[product_id],
        )
        for product_id in product_ids
    ]
    subtotal = sum((line_total for _, _, line_total in line_values), Decimal("0.00"))
    discount = Decimal("0.00")
    total = subtotal

    normalized_received, change_amount = _validate_payment(
        method=payment_method,
        total=total,
        received_amount=received_amount,
    )

    sale = Sale.objects.create(
        cash_session=locked_session,
        cashier=locked_session.cashier,
        subtotal=subtotal,
        discount=discount,
        total=total,
        status=Sale.Status.COMPLETED,
    )

    SaleItem.objects.bulk_create(
        [
            SaleItem(
                sale=sale,
                product=product,
                product_name=product.name,
                unit_price=product.selling_price,
                quantity=quantity,
                line_total=line_total,
            )
            for product, quantity, line_total in line_values
        ]
    )

    Payment.objects.create(
        sale=sale,
        method=payment_method,
        amount=total,
        received_amount=normalized_received,
        change_amount=change_amount,
    )

    for product_id in product_ids:
        stock = stocks_by_product[product_id]
        stock.quantity -= quantities[product_id]
        stock.save(update_fields=("quantity", "updated_at"))

    InventoryMovement.objects.bulk_create(
        [
            InventoryMovement(
                store_id=store_id,
                product_id=product_id,
                movement_type=InventoryMovement.Type.SALE,
                quantity=-quantities[product_id],
                reference=sale.id,
            )
            for product_id in product_ids
        ]
    )

    return sale
