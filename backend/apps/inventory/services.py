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


@transaction.atomic
def receive_stock(
    *,
    store: Store,
    product: Product,
    quantity: int,
) -> ReceiveStockResult:
    if isinstance(quantity, bool) or not isinstance(quantity, int) or quantity <= 0:
        raise InvalidStockQuantity("La quantité reçue doit être un entier positif.")

    try:
        stock = Stock.objects.select_for_update().get(store=store, product=product)
    except Stock.DoesNotExist:
        try:
            with transaction.atomic():
                stock = Stock.objects.create(store=store, product=product, quantity=0)
        except IntegrityError:
            # Une requête concurrente a créé la ligne après notre premier SELECT.
            stock = Stock.objects.select_for_update().get(store=store, product=product)

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
