from dataclasses import dataclass

from django.db import IntegrityError, transaction

from apps.catalog.models import Product
from apps.stores.models import Store

from .exceptions import InvalidStockQuantity
from .models import InventoryMovement, Stock


@dataclass(frozen=True, slots=True)
class ReceiveStockResult:
    stock: Stock
    movement: InventoryMovement
    quantity_added: int


@dataclass(frozen=True, slots=True)
class AdjustStockResult:
    stock: Stock
    movement: InventoryMovement | None
    previous_quantity: int
    delta: int


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
    quantity: int,
) -> ReceiveStockResult:
    if isinstance(quantity, bool) or not isinstance(quantity, int) or quantity <= 0:
        raise InvalidStockQuantity("La quantité reçue doit être un entier positif.")

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
    counted_quantity: int,
) -> AdjustStockResult:
    if isinstance(counted_quantity, bool) or not isinstance(counted_quantity, int) or counted_quantity < 0:
        raise InvalidStockQuantity(
            "Le stock physique compté doit être un entier positif ou nul."
        )

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
