from dataclasses import dataclass
from decimal import Decimal, InvalidOperation

from django.db import IntegrityError, transaction

from apps.catalog.models import Product
from apps.stores.models import Store

from .exceptions import InvalidStockQuantity
from .models import InventoryMovement, Stock


@dataclass(frozen=True, slots=True)
class ReceiveStockResult:
    stock: Stock
    movement: InventoryMovement
    quantity_added: Decimal


@dataclass(frozen=True, slots=True)
class AdjustStockResult:
    stock: Stock
    movement: InventoryMovement | None
    previous_quantity: Decimal
    delta: Decimal


def _validate_quantity(value, *, product: Product, allow_zero: bool) -> Decimal:
    if isinstance(value, bool):
        raise InvalidStockQuantity("La quantité doit être un nombre valide.")
    try:
        quantity = Decimal(value)
    except (InvalidOperation, TypeError, ValueError):
        raise InvalidStockQuantity("La quantité doit être un nombre valide.")
    if quantity < 0 or (not allow_zero and quantity == 0) or quantity.as_tuple().exponent < -3:
        raise InvalidStockQuantity("La quantité doit être positive, avec au plus 3 décimales.")
    quantity = quantity.quantize(Decimal("0.001"))
    if product.sale_unit == Product.SaleUnit.UNIT and quantity != quantity.to_integral_value():
        raise InvalidStockQuantity("La quantité d’un produit vendu à l’unité doit être entière.")
    return quantity


def _get_or_create_locked_stock(*, store: Store, product: Product) -> Stock:
    try:
        return Stock.objects.select_for_update().get(store=store, product=product)
    except Stock.DoesNotExist:
        try:
            with transaction.atomic():
                return Stock.objects.create(store=store, product=product, quantity=0)
        except IntegrityError:
            # Une requête concurrente a créé la ligne après notre premier SELECT.
            return Stock.objects.select_for_update().get(store=store, product=product)


@transaction.atomic
def receive_stock(
    *,
    store: Store,
    product: Product,
    quantity: Decimal,
) -> ReceiveStockResult:
    quantity = _validate_quantity(quantity, product=product, allow_zero=False)

    stock = _get_or_create_locked_stock(store=store, product=product)

    stock.quantity += quantity
    stock.save(update_fields=("quantity", "updated_at"))

    movement = InventoryMovement.objects.create(
        store=store,
        product=product,
        movement_type=InventoryMovement.Type.STOCK_IN,
        quantity=quantity,
    )

    return ReceiveStockResult(
        stock=stock,
        movement=movement,
        quantity_added=quantity,
    )


@transaction.atomic
def adjust_stock(
    *,
    store: Store,
    product: Product,
    counted_quantity: Decimal,
) -> AdjustStockResult:
    counted_quantity = _validate_quantity(counted_quantity, product=product, allow_zero=True)

    stock = _get_or_create_locked_stock(store=store, product=product)

    previous_quantity = stock.quantity
    delta = counted_quantity - previous_quantity

    movement = None
    if delta != 0:
        stock.quantity = counted_quantity
        stock.save(update_fields=("quantity", "updated_at"))

        movement = InventoryMovement.objects.create(
            store=store,
            product=product,
            movement_type=InventoryMovement.Type.ADJUSTMENT,
            quantity=delta,
        )

    return AdjustStockResult(
        stock=stock,
        movement=movement,
        previous_quantity=previous_quantity,
        delta=delta,
    )
