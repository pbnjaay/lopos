from unfold.sites import UnfoldAdminSite

from .context import get_tenant


class TenantAdminSite(UnfoldAdminSite):
    """Le back-office : `is_staff` ne suffit plus, il faut aussi appartenir
    à un commerce actif. Seul le super-utilisateur de la plateforme y entre
    sans organisation."""

    def has_permission(self, request) -> bool:
        if not super().has_permission(request):
            return False
        return request.user.is_superuser or get_tenant(request) is not None
