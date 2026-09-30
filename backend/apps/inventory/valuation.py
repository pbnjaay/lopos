"""Valorisation du stock : ce que vaut la marchandise en rayon, maintenant.

Règles (validées) :
- seule la quantité positive se valorise : un stock négatif (vente hors-ligne
  au-delà du stock serveur) ne vaut rien, il est compté à part comme alerte ;
- un stock au coût inconnu n'est jamais compté à coût 0 : il sort des valeurs
  d'achat, de vente et de la marge potentielle, et sa valeur de vente est
  rapportée à part pour mesurer la couverture ;
- la valeur de vente est au prix catalogue courant — c'est un potentiel, pas
  une marge réalisée.

Tout est calculé en base (annotations et une seule agrégation) : aucune
boucle Python sur les stocks.
"""

import csv
from collections.abc import Iterable
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal
from typing import TextIO

from django.db.models import (
    Count,
    DecimalField,
    ExpressionWrapper,
    F,
    Q,
    QuerySet,
    Sum,
    Value,
)
from django.db.models.functions import Coalesce, Greatest

from .models import Stock

ZERO = Decimal("0.00")
_CENT = Decimal("0.01")
# Quantité (3 décimales) × coût (4 décimales) : 7 décimales exactes.
_VALUE_FIELD = DecimalField(max_digits=28, decimal_places=7)
_QUANTITY_FIELD = DecimalField(max_digits=12, decimal_places=3)

_HAS_STOCK = Q(quantity__gt=0)
_COST_KNOWN = Q(average_unit_cost__isnull=False)


def annotate_stock_values(queryset: QuerySet[Stock]) -> QuerySet[Stock]:
    """Ajoute à chaque stock : `valued_quantity`, `cost_value`, `sale_value`,
    `potential_margin`. `cost_value` et `potential_margin` sont NULL quand le
    coût est inconnu — jamais 0."""
    if "cost_value" in queryset.query.annotations:
        # Déjà annoté (la liste de l'admin) : on le réutilise tel quel.
        return queryset
    valued_quantity = Greatest(
        F("quantity"), Value(Decimal("0"), output_field=_QUANTITY_FIELD)
    )
    return queryset.annotate(
        valued_quantity=valued_quantity,
        cost_value=ExpressionWrapper(
            F("valued_quantity") * F("average_unit_cost"), output_field=_VALUE_FIELD
        ),
        sale_value=ExpressionWrapper(
            F("valued_quantity") * F("product__selling_price"), output_field=_VALUE_FIELD
        ),
        potential_margin=ExpressionWrapper(
            F("sale_value") - F("cost_value"), output_field=_VALUE_FIELD
        ),
    )


@dataclass(frozen=True, slots=True)
class StockValuationSummary:
    # Stocks positifs au coût connu.
    cost_value: Decimal
    sale_value: Decimal
    potential_margin: Decimal
    # Stocks positifs au coût inconnu : non valorisés, signalés.
    uncosted_count: int
    uncosted_sale_value: Decimal
    # Stocks négatifs : non valorisés, signalés.
    negative_count: int
    # Part de la valeur de vente du stock dont le coût est connu, en % ;
    # None s'il n'y a aucun stock positif.
    coverage_percent: int | None

    @property
    def is_complete(self) -> bool:
        return self.uncosted_count == 0


def _sum(field: str, condition: Q) -> Coalesce:
    return Coalesce(Sum(field, filter=condition), ZERO, output_field=_VALUE_FIELD)


def _money(value: Decimal | None) -> Decimal:
    return (value or ZERO).quantize(_CENT, rounding=ROUND_HALF_UP)


def summarize_stock_valuation(queryset: QuerySet[Stock]) -> StockValuationSummary:
    """Totaux de valorisation d'un ensemble de stocks, en une requête.

    Reçoit n'importe quel queryset de `Stock` (déjà filtré par magasin,
    recherche…), pour que les indicateurs suivent exactement la liste
    affichée."""
    totals = annotate_stock_values(queryset).aggregate(
        total_cost_value=_sum("cost_value", _HAS_STOCK & _COST_KNOWN),
        total_sale_value=_sum("sale_value", _HAS_STOCK & _COST_KNOWN),
        total_uncosted_sale_value=_sum("sale_value", _HAS_STOCK & ~_COST_KNOWN),
        positive_count=Count("id", filter=_HAS_STOCK),
        uncosted_count=Count("id", filter=_HAS_STOCK & ~_COST_KNOWN),
        negative_count=Count("id", filter=Q(quantity__lt=0)),
    )

    cost_value = _money(totals["total_cost_value"])
    sale_value = _money(totals["total_sale_value"])
    uncosted_sale_value = _money(totals["total_uncosted_sale_value"])
    total_sale_value = sale_value + uncosted_sale_value
    positive_count = totals["positive_count"]
    uncosted_count = totals["uncosted_count"]
    if not positive_count:
        coverage_percent = None
    elif total_sale_value:
        coverage_percent = _percent(sale_value, total_sale_value)
    else:
        # Que des prix de vente à 0 : on retombe sur la part des produits.
        coverage_percent = _percent(
            Decimal(positive_count - uncosted_count), Decimal(positive_count)
        )

    return StockValuationSummary(
        cost_value=cost_value,
        sale_value=sale_value,
        potential_margin=sale_value - cost_value,
        uncosted_count=uncosted_count,
        uncosted_sale_value=uncosted_sale_value,
        negative_count=totals["negative_count"],
        coverage_percent=coverage_percent,
    )


def _percent(part: Decimal, whole: Decimal) -> int:
    return int((part / whole * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def get_stock_valuation(*, store_id=None) -> StockValuationSummary:
    """Valorisation d'un magasin, ou de tous si `store_id` est None — à
    l'appelant d'afficher alors explicitement « Tous les magasins »."""
    queryset = Stock.objects.all()
    if store_id is not None:
        queryset = queryset.filter(store_id=store_id)
    return summarize_stock_valuation(queryset)


# --- Export CSV ------------------------------------------------------------------

CSV_HEADER = (
    "Produit",
    "Code-barres",
    "Magasin",
    "Stock",
    "Coût moyen",
    "Valeur d'achat",
    "Prix de vente",
    "Valeur de vente",
    "Marge potentielle",
)


def _csv_number(value: Decimal | None, *, places: str = "0.01") -> str:
    """Nombre lisible par un tableur français : virgule décimale, pas de
    séparateur de milliers ; vide quand la valeur est inconnue (jamais 0)."""
    if value is None:
        return ""
    rounded = value.quantize(Decimal(places), rounding=ROUND_HALF_UP)
    return f"{rounded.normalize():f}".replace(".", ",")


def write_stock_valuation_csv(stocks: Iterable[Stock], output: TextIO) -> None:
    """Une ligne par stock annoté (`annotate_stock_values`), avec produit et
    magasin chargés. Séparateur « ; » et BOM UTF-8 : le fichier s'ouvre tel
    quel dans Excel en français."""
    output.write("\ufeff")
    writer = csv.writer(output, delimiter=";")
    writer.writerow(CSV_HEADER)
    for stock in stocks:
        writer.writerow(
            (
                stock.product.name,
                stock.product.barcode or "",
                stock.store.name,
                _csv_number(stock.quantity, places="0.001"),
                _csv_number(stock.average_unit_cost),
                _csv_number(stock.cost_value),
                _csv_number(stock.product.selling_price),
                _csv_number(stock.sale_value),
                _csv_number(stock.potential_margin),
            )
        )
