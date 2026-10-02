"""En-tête de la fiche produit : où il est, combien il en reste, ce qu'il vaut
et comment il se vend — au-dessus du formulaire, qui reste pour modifier."""

from dataclasses import dataclass, field
from datetime import timedelta

from django.db.models import Sum
from django.urls import reverse
from django.utils import timezone

from apps.dashboard.formatting import format_fcfa, format_quantity
from apps.inventory.admin import effective_low_stock_threshold
from apps.inventory.models import InventoryMovement, Stock
from apps.sales.models import Sale, SaleItem

from .models import Product

SALES_WINDOW_DAYS = 30
RECENT_MOVEMENTS = 5


@dataclass(frozen=True, slots=True)
class StoreStock:
    store: str
    quantity: str
    # (type de pastille, texte) : Rupture / Faible / OK.
    status: tuple[str, str]
    average_cost: str | None
    cost_value: str | None


@dataclass(frozen=True, slots=True)
class RecentMovement:
    date: str
    kind: str
    quantity: str
    store: str


@dataclass(frozen=True, slots=True)
class ProductCard:
    selling_price: str
    last_purchase_price: str | None
    can_view_costs: bool
    stocks: list[StoreStock] = field(default_factory=list)
    sold_quantity: str = "0"
    sold_revenue: str = "0 FCFA"
    movements: list[RecentMovement] = field(default_factory=list)
    receive_url: str = ""
    adjust_url: str = ""
    movements_url: str = ""


def _status(stock: Stock, product: Product) -> tuple[str, str]:
    if stock.quantity <= 0:
        return "danger", "Rupture"
    if stock.quantity <= effective_low_stock_threshold(product):
        return "warning", "Faible"
    return "success", "OK"


def build_product_card(
    product: Product, *, can_view_costs: bool, store_ids=None
) -> ProductCard:
    """Fiche d'un produit, limitée aux magasins `store_ids` (ceux du compte ;
    `None` pour la plateforme) : stock, ventes et mouvements d'autres
    magasins n'y apparaissent pas."""

    def within(queryset, path):
        return queryset if store_ids is None else queryset.filter(**{f"{path}__in": store_ids})

    stocks = []
    for stock in within(Stock.objects.filter(product=product), "store_id").select_related(
        "store"
    ).order_by("store__name"):
        known_cost = can_view_costs and stock.average_unit_cost is not None
        stocks.append(
            StoreStock(
                store=stock.store.name,
                quantity=format_quantity(stock.quantity, product.sale_unit),
                status=_status(stock, product),
                average_cost=format_fcfa(stock.average_unit_cost) if known_cost else None,
                cost_value=(
                    format_fcfa(max(stock.quantity, 0) * stock.average_unit_cost)
                    if known_cost
                    else None
                ),
            )
        )

    since = timezone.now() - timedelta(days=SALES_WINDOW_DAYS)
    sold = within(
        SaleItem.objects.filter(
            product=product, sale__status=Sale.Status.COMPLETED, sale__occurred_at__gte=since
        ),
        "sale__cash_session__cash_register__store_id",
    ).aggregate(quantity=Sum("quantity"), revenue=Sum("line_total"))

    movements = [
        RecentMovement(
            date=timezone.localtime(movement.created_at).strftime("%d/%m %H:%M"),
            kind=movement.get_movement_type_display(),
            quantity=(
                ("+" if movement.quantity > 0 else "")
                + format_quantity(movement.quantity, product.sale_unit)
            ),
            store=movement.store.name,
        )
        for movement in within(InventoryMovement.objects.filter(product=product), "store_id")
        .select_related("store")
        .order_by("-created_at")[:RECENT_MOVEMENTS]
    ]

    return ProductCard(
        selling_price=format_fcfa(product.selling_price),
        last_purchase_price=(
            format_fcfa(product.purchase_price)
            if can_view_costs and product.purchase_price
            else None
        ),
        can_view_costs=can_view_costs,
        stocks=stocks,
        sold_quantity=format_quantity(sold["quantity"] or 0, product.sale_unit),
        sold_revenue=format_fcfa(sold["revenue"] or 0),
        movements=movements,
        receive_url=reverse("admin:catalog_product_receive_stock", args=[product.pk]),
        adjust_url=reverse("admin:catalog_product_adjust_stock", args=[product.pk]),
        movements_url=(
            f"{reverse('admin:inventory_inventorymovement_changelist')}"
            f"?q={product.barcode or product.name}"
        ),
    )
