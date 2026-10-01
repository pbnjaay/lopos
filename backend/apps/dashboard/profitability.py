"""Rentabilité d'une période : ce que l'activité a approximativement rapporté.

Définitions (validées) :
- Chiffre d'affaires = lignes vendues (ventes terminées, date de la vente)
  − articles retournés (date du retour). Du CA, jamais de l'encaissé : une
  vente au cahier compte pour son total, un remboursement du cahier ne compte
  pas.
- Coût des marchandises vendues = quantité × coût figé sur chaque ligne
  vendue, moins le coût des articles retournés et remis en stock. Un article
  retourné mais non remis en stock garde son coût : la marchandise est
  perdue (il est rapporté à part, « dont retours non remis en stock »).
- Une ligne au coût inconnu ne compte jamais à coût 0 : elle sort à la fois
  du CA couvert et du coût. La marge brute porte sur le CA couvert ; le reste
  est signalé (couverture). Le résultat est ainsi prudent, jamais gonflé.
- Marge brute = CA couvert − coût des marchandises vendues.
- Résultat estimé = marge brute − dépenses enregistrées (non annulées, tous
  moyens de paiement). Ce n'est pas un résultat comptable.
- Les ajustements d'inventaire n'entrent pas dans le résultat (V1).

Trois requêtes d'agrégation au plus (ventes, retours, dépenses), deux quand
l'appelant fournit déjà le total des dépenses.
"""

from dataclasses import dataclass
from datetime import datetime
from decimal import ROUND_HALF_UP, Decimal

from django.db.models import Count, DecimalField, ExpressionWrapper, F, Q, Sum
from django.db.models.functions import Coalesce

from apps.expenses.models import Expense
from apps.sales.models import Sale, SaleItem, SaleReturn, SaleReturnItem

ZERO = Decimal("0.00")
_CENT = Decimal("0.01")
_VALUE_FIELD = DecimalField(max_digits=28, decimal_places=7)


@dataclass(frozen=True, slots=True)
class ProfitabilitySummary:
    revenue: Decimal
    # Part du CA dont le coût d'achat est connu, et le reste.
    covered_revenue: Decimal
    uncovered_revenue: Decimal
    cost_of_goods_sold: Decimal
    # Coût des articles retournés sans remise en stock, compris dans le coût
    # des marchandises vendues.
    unrestocked_return_cost: Decimal
    gross_margin: Decimal
    expenses: Decimal
    estimated_result: Decimal
    # Part du CA couverte par un coût connu, en % ; None si le CA est nul.
    coverage_percent: int | None
    # Au moins une ligne de la période a un coût connu : sans elle, marge et
    # résultat n'ont aucun sens et ne s'affichent pas.
    has_cost_data: bool

    @property
    def is_complete(self) -> bool:
        return self.uncovered_revenue == ZERO


def _sum(expression, condition: Q | None = None) -> Coalesce:
    return Coalesce(Sum(expression, filter=condition), ZERO, output_field=_VALUE_FIELD)


def _money(value: Decimal) -> Decimal:
    return value.quantize(_CENT, rounding=ROUND_HALF_UP)


def _line_cost(quantity: str, unit_cost: str) -> ExpressionWrapper:
    return ExpressionWrapper(F(quantity) * F(unit_cost), output_field=_VALUE_FIELD)


def get_profitability_summary(
    *,
    start: datetime,
    end: datetime,
    store_id=None,
    store_ids=None,
    expenses_total: Decimal | None = None,
) -> ProfitabilitySummary:
    """Rentabilité de [start, end), pour un magasin (`store_id`), une liste
    (`store_ids`) ou tous (les deux None, plateforme —
    à l'appelant d'afficher alors « Tous les magasins »)."""
    sale_lines = SaleItem.objects.filter(
        sale__status=Sale.Status.COMPLETED,
        sale__occurred_at__gte=start,
        sale__occurred_at__lt=end,
    )
    return_lines = SaleReturnItem.objects.filter(
        sale_return__status=SaleReturn.Status.COMPLETED,
        sale_return__created_at__gte=start,
        sale_return__created_at__lt=end,
    )
    if store_id is not None:
        store_ids = [store_id]
    if store_ids is not None:
        sale_lines = sale_lines.filter(sale__cash_session__cash_register__store_id__in=store_ids)
        return_lines = return_lines.filter(
            sale_return__cash_session__cash_register__store_id__in=store_ids
        )

    sale_cost_known = Q(unit_cost__isnull=False)
    sold = sale_lines.aggregate(
        revenue=_sum("line_total"),
        covered_revenue=_sum("line_total", sale_cost_known),
        cost=_sum(_line_cost("quantity", "unit_cost"), sale_cost_known),
        costed_lines=Count("id", filter=sale_cost_known),
    )

    return_cost_known = Q(original_sale_item__unit_cost__isnull=False)
    returned_cost = _line_cost("quantity", "original_sale_item__unit_cost")
    returned = return_lines.aggregate(
        revenue=_sum("refund_amount"),
        covered_revenue=_sum("refund_amount", return_cost_known),
        restocked_cost=_sum(returned_cost, return_cost_known & Q(restock=True)),
        unrestocked_cost=_sum(returned_cost, return_cost_known & Q(restock=False)),
        costed_lines=Count("id", filter=return_cost_known),
    )

    if expenses_total is None:
        expenses_total = _posted_expenses(start=start, end=end, store_ids=store_ids)

    revenue = _money(sold["revenue"] - returned["revenue"])
    covered_revenue = _money(sold["covered_revenue"] - returned["covered_revenue"])
    cost_of_goods_sold = _money(sold["cost"] - returned["restocked_cost"])
    gross_margin = covered_revenue - cost_of_goods_sold
    expenses = _money(expenses_total)
    coverage_percent = (
        int((covered_revenue / revenue * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
        if revenue > 0
        else None
    )

    return ProfitabilitySummary(
        revenue=revenue,
        covered_revenue=covered_revenue,
        uncovered_revenue=revenue - covered_revenue,
        cost_of_goods_sold=cost_of_goods_sold,
        unrestocked_return_cost=_money(returned["unrestocked_cost"]),
        gross_margin=gross_margin,
        expenses=expenses,
        estimated_result=gross_margin - expenses,
        coverage_percent=coverage_percent,
        has_cost_data=bool(sold["costed_lines"] or returned["costed_lines"]),
    )


def _posted_expenses(*, start: datetime, end: datetime, store_ids) -> Decimal:
    expenses = Expense.objects.filter(
        status=Expense.Status.POSTED, occurred_at__gte=start, occurred_at__lt=end
    )
    if store_ids is not None:
        expenses = expenses.filter(store_id__in=store_ids)
    return expenses.aggregate(total=Sum("amount"))["total"] or ZERO
