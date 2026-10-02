"""Qui peut voir les coûts d'achat.

Le coût moyen et la valeur du stock suivent la permission de la page
Valorisation : un membre du staff qui réceptionne ou ajuste du stock sans
elle ne voit que les quantités (il saisit le prix d'achat de ce qu'il
réceptionne, mais pas le coût moyen du magasin).
"""

VIEW_STOCK_COSTS_PERMISSION = "inventory.view_stockvaluation"
SET_STOCK_COST_PERMISSION = "inventory.set_cost_stockvaluation"


def can_view_stock_costs(user) -> bool:
    return user.has_perm(VIEW_STOCK_COSTS_PERMISSION)
