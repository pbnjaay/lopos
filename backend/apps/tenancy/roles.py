"""Le rôle d'un membre décide de ses droits Django.

Propriétaire, gérant ou caissier : chaque rôle correspond à un groupe dont
`create_default_groups` fixe les permissions. Un compte n'a jamais qu'un de
ces trois groupes, celui de son rôle actif, et n'ouvre l'administration
(`is_staff`) que comme propriétaire ou gérant. Toute modification d'un
membre passe par `sync_member_access` : rien d'autre ne pose ces groupes.

Les coûts, eux, suivent en plus « voit les coûts et marges »
(`backends.CostVisibilityBackend`).
"""

from django.contrib.auth.models import Group

from apps.stores.models import StoreAssignment

from .models import OrganizationMembership

Role = OrganizationMembership.Role

OWNER_GROUP = "Propriétaire"
MANAGER_GROUP = "Gérant"
CASHIER_GROUP = "Caissier"

ROLE_GROUPS = {
    Role.OWNER: OWNER_GROUP,
    Role.MANAGER: MANAGER_GROUP,
    Role.CASHIER: CASHIER_GROUP,
}

ADMIN_ROLES = (Role.OWNER, Role.MANAGER)


def sync_member_access(user) -> None:
    """Aligne groupes, accès à l'administration et affectations sur le rôle
    actif du compte.

    Sans membre actif (retiré, ou jamais rattaché), plus aucun groupe de rôle
    ni accès à l'administration ; ses affectations restent, pour une
    éventuelle réactivation. Passé à un autre commerce, ses affectations aux
    magasins de l'ancien sont désactivées. Le super-utilisateur de la
    plateforme n'est jamais touché."""
    if user.is_superuser:
        return
    membership = (
        OrganizationMembership.objects.filter(user=user, is_active=True)
        .only("role", "organization_id")
        .first()
    )
    user.groups.remove(*Group.objects.filter(name__in=ROLE_GROUPS.values()))
    if membership is not None:
        group, _ = Group.objects.get_or_create(name=ROLE_GROUPS[membership.role])
        user.groups.add(group)
        StoreAssignment.objects.filter(user=user, is_active=True).exclude(
            store__organization_id=membership.organization_id
        ).update(is_active=False)

    is_staff = membership is not None and membership.role in ADMIN_ROLES
    if user.is_staff != is_staff:
        user.is_staff = is_staff
        user.save(update_fields=["is_staff"])
