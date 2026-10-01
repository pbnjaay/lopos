from django.core.exceptions import PermissionDenied

from .context import resolve_tenant

# Coût d'achat, valeur du stock et marges : la valorisation, le journal des
# coûts, la définition d'un coût et la carte de rentabilité.
COST_PERMISSIONS = frozenset(
    {
        "inventory.view_stockvaluation",
        "inventory.set_cost_stockvaluation",
        "inventory.view_stockcostchange",
        "sales.view_profitability",
    }
)


class CostVisibilityBackend:
    """Veto sur les coûts, placé avant `ModelBackend`.

    Les permissions de coût viennent des groupes Django, mais c'est le membre
    qui décide : propriétaire toujours, gérant seulement si « voit les coûts
    et marges » est coché, caissier jamais. Lever `PermissionDenied` arrête
    Django avant les autres backends, quel que soit le groupe du compte.
    Le super-utilisateur de la plateforme n'est jamais concerné (Django lui
    accorde tout avant d'interroger les backends)."""

    def authenticate(self, request, **credentials):
        return None

    def has_perm(self, user_obj, perm, obj=None) -> bool:
        if perm in COST_PERMISSIONS and not self._can_view_costs(user_obj):
            raise PermissionDenied
        return False

    def _can_view_costs(self, user_obj) -> bool:
        # Calculé une fois par objet utilisateur, donc par requête : la barre
        # latérale et une page interrogent plusieurs fois les mêmes droits.
        if not hasattr(user_obj, "_can_view_costs_cache"):
            tenant = resolve_tenant(user_obj)
            user_obj._can_view_costs_cache = tenant is not None and tenant.can_view_costs
        return user_obj._can_view_costs_cache
