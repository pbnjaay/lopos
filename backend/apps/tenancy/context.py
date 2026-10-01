"""Pour quel commerce, avec quel rôle et dans quels magasins agit un compte.

Recalculé à chaque requête, jamais tiré de la session ni du client : un
compte désactivé, un membre retiré ou une organisation suspendue perdent
l'accès dès la requête suivante.
"""

from dataclasses import dataclass
from uuid import UUID

from apps.stores.models import Store

from .models import Organization, OrganizationMembership

Role = OrganizationMembership.Role


@dataclass(frozen=True)
class TenantContext:
    membership: OrganizationMembership
    store_ids: frozenset[UUID]

    @property
    def organization(self) -> Organization:
        return self.membership.organization

    @property
    def role(self) -> str:
        return self.membership.role

    @property
    def can_view_costs(self) -> bool:
        if self.role == Role.OWNER:
            return True
        return self.role == Role.MANAGER and self.membership.can_view_costs

    def can_access_store(self, store_id) -> bool:
        return store_id in self.store_ids

    def can_manage_store(self, store_id) -> bool:
        """Gérer un magasin : annuler la vente ou la dépense d'un autre,
        consulter ou clôturer la caisse d'un collègue."""
        return self.role in (Role.OWNER, Role.MANAGER) and self.can_access_store(store_id)


class TenantDenial:
    NO_ACTIVE_MEMBERSHIP = "NO_ACTIVE_MEMBERSHIP"
    ORGANIZATION_SUSPENDED = "ORGANIZATION_SUSPENDED"

    MESSAGES = {
        NO_ACTIVE_MEMBERSHIP: "Ce compte n’a accès à aucun commerce.",
        ORGANIZATION_SUSPENDED: "L’accès de ce commerce est suspendu.",
    }


def resolve_tenant(user) -> TenantContext | None:
    if user is None or not user.is_authenticated or not user.is_active:
        return None
    membership = (
        OrganizationMembership.objects.select_related("organization")
        .filter(
            user=user,
            is_active=True,
            organization__status=Organization.Status.ACTIVE,
        )
        .first()
    )
    if membership is None:
        return None

    stores = Store.objects.filter(organization_id=membership.organization_id)
    if membership.role != Role.OWNER:
        stores = stores.filter(
            user_assignments__user=user, user_assignments__is_active=True
        )
    return TenantContext(
        membership=membership,
        store_ids=frozenset(stores.values_list("pk", flat=True)),
    )


def denial_reason(user) -> str:
    """Pourquoi `resolve_tenant` n'a rien trouvé, pour le dire au client."""
    if OrganizationMembership.objects.filter(
        user=user,
        is_active=True,
        organization__status=Organization.Status.SUSPENDED,
    ).exists():
        return TenantDenial.ORGANIZATION_SUSPENDED
    return TenantDenial.NO_ACTIVE_MEMBERSHIP


def get_tenant(request) -> TenantContext | None:
    """Contexte du compte de la requête, calculé une fois par requête.

    Accepte une requête Django comme une requête DRF : c'est l'utilisateur
    authentifié par DRF qui compte (`force_authenticate` en test ne touche
    pas la requête Django sous-jacente)."""
    user = getattr(request, "user", None)
    holder = getattr(request, "_request", request)
    cached = getattr(holder, "_tenant_cache", None)
    user_pk = getattr(user, "pk", None)
    if cached is not None and cached[0] == user_pk:
        return cached[1]
    tenant = resolve_tenant(user)
    holder._tenant_cache = (user_pk, tenant)
    return tenant
