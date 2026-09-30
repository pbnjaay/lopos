from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

from django.db import IntegrityError, transaction

from apps.catalog.models import Product
from apps.stores.models import Store

from .exceptions import InvalidStockCost, InvalidStockQuantity
from .models import InventoryMovement, Stock

# Précision du coût moyen : 333,3333 pour 10 000 / 30. L'arrondi (au plus
# proche, moitié vers le haut) ne dérive que d'une fraction de FCFA.
COST_QUANTUM = Decimal("0.0001")


@dataclass(frozen=True, slots=True)
class ReceiveStockResult:
    stock: Stock
    movement: InventoryMovement
    quantity_added: Decimal
    # Coût appliqué à ce lot (None s'il est resté inconnu).
    unit_cost: Decimal | None


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


def _validate_unit_cost(value) -> Decimal | None:
    if value is None:
        return None
    if isinstance(value, bool):
        raise InvalidStockCost("Le coût d’achat doit être un nombre valide.")
    try:
        cost = Decimal(value)
    except (InvalidOperation, TypeError, ValueError):
        raise InvalidStockCost("Le coût d’achat doit être un nombre valide.")
    if not cost.is_finite() or cost < 0 or cost.as_tuple().exponent < -4:
        raise InvalidStockCost("Le coût d’achat doit être positif, avec au plus 4 décimales.")
    return cost.quantize(COST_QUANTUM)


def weighted_average_cost(
    *,
    quantity: Decimal,
    average_cost: Decimal | None,
    incoming_quantity: Decimal,
    incoming_cost: Decimal | None,
) -> Decimal | None:
    """Coût moyen pondéré après l'entrée de `incoming_quantity` unités.

    - lot de coût inconnu : le coût moyen ne bouge pas (inconnu s'il l'était) ;
    - stock vide ou négatif, ou coût moyen inconnu : le lot fixe le coût — les
      unités vendues à découvert ont déjà été comptées au coût de l'époque, et
      une moyenne pondérée par une quantité négative n'aurait pas de sens ;
    - sinon : (Q·C + q·c) / (Q + q).
    """
    if incoming_cost is None:
        return average_cost
    if quantity <= 0 or average_cost is None:
        return incoming_cost
    total_value = quantity * average_cost + incoming_quantity * incoming_cost
    return (total_value / (quantity + incoming_quantity)).quantize(
        COST_QUANTUM, rounding=ROUND_HALF_UP
    )


def _apply_inbound_cost(stock: Stock, quantity: Decimal, unit_cost: Decimal | None) -> None:
    """Fusionne `quantity` unités à `unit_cost` dans le coût moyen du stock,
    avant que sa quantité n'augmente. Ne sauvegarde pas."""
    stock.average_unit_cost = weighted_average_cost(
        quantity=stock.quantity,
        average_cost=stock.average_unit_cost,
        incoming_quantity=quantity,
        incoming_cost=unit_cost,
    )


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
    unit_cost: Decimal | None = None,
    created_by=None,
) -> ReceiveStockResult:
    """Entrée de marchandise, valorisée au coût d'achat du lot.

    `unit_cost` est le prix payé pour une unité (ou un kg). Sans lui (API,
    import), on retombe sur le dernier prix d'achat du produit s'il est
    renseigné — 0 comptant comme inconnu ; à défaut le lot reste de coût
    inconnu et le coût moyen ne bouge pas. Un coût saisi devient le dernier
    prix d'achat du produit.
    """
    quantity = _validate_quantity(quantity, product=product, allow_zero=False)
    explicit_cost = _validate_unit_cost(unit_cost)
    if explicit_cost is not None:
        lot_cost = explicit_cost
    elif product.purchase_price:
        lot_cost = product.purchase_price.quantize(COST_QUANTUM)
    else:
        lot_cost = None

    stock = _get_or_create_locked_stock(store=store, product=product)

    _apply_inbound_cost(stock, quantity, lot_cost)
    stock.quantity += quantity
    stock.save(update_fields=("quantity", "average_unit_cost", "updated_at"))

    movement = InventoryMovement.objects.create(
        store=store,
        product=product,
        movement_type=InventoryMovement.Type.STOCK_IN,
        quantity=quantity,
        unit_cost=lot_cost,
        created_by=created_by,
    )

    # Un lot gratuit (coût 0) n'est pas un prix d'achat : il compte dans la
    # moyenne mais ne remplace pas le dernier prix payé au fournisseur.
    if explicit_cost:
        last_price = explicit_cost.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        if product.purchase_price != last_price:
            # update() plutôt que save() : le produit n'a pas changé pour le
            # POS, sa date de modification (et donc sa synchro) ne bouge pas.
            Product.objects.filter(pk=product.pk).update(purchase_price=last_price)
            product.purchase_price = last_price

    return ReceiveStockResult(
        stock=stock,
        movement=movement,
        quantity_added=quantity,
        unit_cost=lot_cost,
    )


@transaction.atomic
def adjust_stock(
    *,
    store: Store,
    product: Product,
    counted_quantity: Decimal,
    created_by=None,
) -> AdjustStockResult:
    """Aligne le stock sur le comptage physique. Le coût moyen ne change
    pas : les unités retrouvées ou perdues sont valorisées au coût moyen
    courant, inscrit sur le mouvement."""
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
            unit_cost=stock.average_unit_cost,
            created_by=created_by,
        )

    return AdjustStockResult(
        stock=stock,
        movement=movement,
        previous_quantity=previous_quantity,
        delta=delta,
    )
