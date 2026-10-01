import sentry_sdk
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import BasePermission

from .context import TenantDenial, denial_reason, get_tenant


class TenantAccessDenied(PermissionDenied):
    def __init__(self, code: str) -> None:
        super().__init__(detail={"code": code, "message": TenantDenial.MESSAGES[code]})


class HasActiveTenant(BasePermission):
    """Permission par défaut de toute l'API : un compte n'y fait rien sans
    appartenir à un commerce actif. Un super-utilisateur de la plateforme
    sans membre n'y a donc pas accès — il administre, il ne vend pas."""

    def has_permission(self, request, view) -> bool:
        if not request.user or not request.user.is_authenticated:
            return False
        tenant = get_tenant(request)
        if tenant is None:
            raise TenantAccessDenied(denial_reason(request.user))
        # Contexte technique des erreurs : quel commerce, quel rôle — jamais
        # de données de clients.
        sentry_sdk.set_tag("organization_id", str(tenant.organization.pk))
        sentry_sdk.set_tag("role", tenant.role)
        return True
