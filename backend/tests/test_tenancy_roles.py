"""Phase 5 : le rôle du membre décide de ses droits.

Groupes Django et accès à l'administration découlent du rôle actif
(`sync_member_access`) ; le propriétaire gère les comptes de son commerce,
la plateforme nomme les propriétaires.
"""

import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.management import call_command
from django.test import Client
from django.urls import reverse

from apps.tenancy.models import Organization, OrganizationMembership
from apps.tenancy.roles import sync_member_access

from .tenancy_factories import Commerce, build_commerce

pytestmark = [pytest.mark.django_db, pytest.mark.explicit_tenancy]
User = get_user_model()
Role = OrganizationMembership.Role


@pytest.fixture(autouse=True)
def role_groups() -> None:
    call_command("create_default_groups")


@pytest.fixture
def a() -> Commerce:
    commerce = build_commerce("a")
    for user in (commerce.owner, commerce.cashier):
        sync_member_access(user)
    return commerce


@pytest.fixture
def owner_a(a: Commerce) -> Client:
    client = Client()
    client.force_login(a.owner)
    return client


def _groups(user) -> set[str]:
    return set(User.objects.get(pk=user.pk).groups.values_list("name", flat=True))


def _staff(user) -> bool:
    return User.objects.get(pk=user.pk).is_staff


# --- Synchronisation rôle → groupes ----------------------------------------


@pytest.mark.parametrize(
    ("role", "group", "is_staff"),
    [
        (Role.OWNER, "Propriétaire", True),
        (Role.MANAGER, "Gérant", True),
        (Role.CASHIER, "Caissier", False),
    ],
)
def test_role_gives_exactly_its_group_and_admin_access(a, role, group, is_staff) -> None:
    user = User.objects.create_user(username="membre", is_staff=not is_staff)
    user.groups.add(Group.objects.get(name="Gérant"), Group.objects.get(name="Caissier"))
    OrganizationMembership.objects.create(organization=a.organization, user=user, role=role)

    sync_member_access(user)

    assert _groups(user) == {group}
    assert _staff(user) is is_staff


def test_account_without_active_membership_loses_role_groups_and_admin(a) -> None:
    OrganizationMembership.objects.filter(user=a.owner).update(is_active=False)

    sync_member_access(a.owner)

    assert _groups(a.owner) == set()
    assert _staff(a.owner) is False


def test_other_groups_and_superusers_are_left_alone(a) -> None:
    custom = Group.objects.create(name="Comptable externe")
    a.cashier.groups.add(custom)
    root = User.objects.create_superuser(username="plateforme")

    sync_member_access(a.cashier)
    sync_member_access(root)

    assert _groups(a.cashier) == {"Caissier", "Comptable externe"}
    assert User.objects.get(pk=root.pk).is_staff is True


def test_group_command_realigns_every_account_on_its_role(a) -> None:
    # État hérité d'avant les rôles : caissier staff dans le groupe Gérant.
    a.cashier.groups.set([Group.objects.get(name="Gérant")])
    User.objects.filter(pk=a.cashier.pk).update(is_staff=True)

    call_command("create_default_groups")

    assert _groups(a.cashier) == {"Caissier"}
    assert _staff(a.cashier) is False
    assert _groups(a.owner) == {"Propriétaire"}


# --- Le propriétaire gère les comptes de son commerce ----------------------


def _add_member(client, username: str, **member) -> None:
    client.post(
        reverse("admin:auth_user_add"),
        {
            "username": username,
            "usable_password": "true",
            "password1": "Passer-1234!",
            "password2": "Passer-1234!",
            "store_assignments-TOTAL_FORMS": "0",
            "store_assignments-INITIAL_FORMS": "0",
            "store_assignments-MIN_NUM_FORMS": "0",
            "store_assignments-MAX_NUM_FORMS": "1000",
            **member,
        },
    )


def test_owner_creates_a_manager_with_cost_access(a, owner_a) -> None:
    _add_member(owner_a, "moussa", role="MANAGER", can_view_costs="on")

    user = User.objects.get(username="moussa")
    membership = user.memberships.get()
    assert (membership.organization, membership.role, membership.can_view_costs) == (
        a.organization,
        Role.MANAGER,
        True,
    )
    assert _groups(user) == {"Gérant"}
    assert _staff(user) is True


def test_owner_creates_a_cashier_who_never_sees_costs(a, owner_a) -> None:
    _add_member(owner_a, "fatou", role="CASHIER", can_view_costs="on")

    user = User.objects.get(username="fatou")
    assert user.memberships.get().can_view_costs is False
    assert _groups(user) == {"Caissier"}
    assert _staff(user) is False


def test_owner_cannot_create_another_owner(a, owner_a) -> None:
    _add_member(owner_a, "intrus", role="OWNER")

    assert not User.objects.filter(username="intrus").exists()


def _change_member(client, user, **member):
    return client.post(
        reverse("admin:auth_user_change", args=[user.pk]),
        {
            "username": user.username,
            "first_name": "",
            "last_name": "",
            "email": "",
            "is_active": "on",
            "date_joined_0": "2026-01-01",
            "date_joined_1": "00:00:00",
            "store_assignments-TOTAL_FORMS": "0",
            "store_assignments-INITIAL_FORMS": "0",
            "store_assignments-MIN_NUM_FORMS": "0",
            "store_assignments-MAX_NUM_FORMS": "1000",
            **member,
        },
    )


def test_promoting_and_demoting_a_member_moves_its_admin_access(a, owner_a) -> None:
    _change_member(owner_a, a.cashier, role="MANAGER")
    assert _groups(a.cashier) == {"Gérant"}
    assert _staff(a.cashier) is True

    _change_member(owner_a, a.cashier, role="CASHIER")
    assert _groups(a.cashier) == {"Caissier"}
    assert _staff(a.cashier) is False


def test_owner_cannot_change_its_own_role(a, owner_a) -> None:
    form = owner_a.get(reverse("admin:auth_user_change", args=[a.owner.pk])).context[
        "adminform"
    ].form

    assert "role" not in form.fields
    _change_member(owner_a, a.owner, role="CASHIER")
    assert a.owner.memberships.get().role == Role.OWNER


def test_owner_cannot_edit_another_owner(a, owner_a) -> None:
    other = User.objects.create_user(username="associe", is_staff=True)
    OrganizationMembership.objects.create(organization=a.organization, user=other, role=Role.OWNER)

    response = _change_member(owner_a, other, role="CASHIER", is_active="")

    assert response.status_code == 403
    other.refresh_from_db()
    assert other.is_active
    assert other.memberships.get().role == Role.OWNER


# --- Ce que chaque rôle atteint dans l'administration ----------------------


def _client_for(a: Commerce, role: str) -> Client:
    user = User.objects.create_user(username=f"membre-{role.lower()}")
    OrganizationMembership.objects.create(organization=a.organization, user=user, role=role)
    sync_member_access(user)
    client = Client()
    client.force_login(user)
    return client


def test_manager_runs_operations_but_not_the_commerce(a) -> None:
    manager = _client_for(a, Role.MANAGER)

    assert manager.get(reverse("admin:catalog_product_changelist")).status_code == 200
    assert manager.get(reverse("admin:stores_store_changelist")).status_code == 200
    for forbidden in (
        "admin:auth_user_changelist",
        "admin:stores_storeassignment_changelist",
        "admin:stores_store_add",
        "admin:stores_cashregister_add",
    ):
        assert manager.get(reverse(forbidden)).status_code == 403, forbidden


def test_owner_manages_stores_registers_and_accounts(a, owner_a) -> None:
    for allowed in (
        "admin:auth_user_changelist",
        "admin:stores_storeassignment_changelist",
        "admin:stores_store_add",
        "admin:stores_cashregister_add",
    ):
        assert owner_a.get(reverse(allowed)).status_code == 200, allowed


def test_cashier_stays_out_of_the_admin(a) -> None:
    response = _client_for(a, Role.CASHIER).get(reverse("admin:index"))

    assert response.status_code == 302


# --- La plateforme nomme et retire les propriétaires ------------------------


def test_platform_names_an_owner_from_the_organization_page(a) -> None:
    newcomer = User.objects.create_user(username="nouveau-proprietaire")
    platform = Client()
    platform.force_login(User.objects.create_superuser(username="plateforme"))
    store_ids = list(a.organization.stores.values_list("pk", flat=True))
    memberships = list(a.organization.memberships.order_by("pk"))
    data = {
        "name": a.organization.name,
        "slug": a.organization.slug,
        "status": Organization.Status.ACTIVE,
        "stores-TOTAL_FORMS": str(len(store_ids)),
        "stores-INITIAL_FORMS": str(len(store_ids)),
        "stores-MIN_NUM_FORMS": "0",
        "stores-MAX_NUM_FORMS": "1000",
        "memberships-TOTAL_FORMS": str(len(memberships) + 1),
        "memberships-INITIAL_FORMS": str(len(memberships)),
        "memberships-MIN_NUM_FORMS": "0",
        "memberships-MAX_NUM_FORMS": "1000",
        "_save": "Save",
    }
    for index, store_id in enumerate(store_ids):
        data[f"stores-{index}-id"] = str(store_id)
        data[f"stores-{index}-organization"] = str(a.organization.pk)
    for index, membership in enumerate(memberships):
        data.update(
            {
                f"memberships-{index}-id": str(membership.pk),
                f"memberships-{index}-organization": str(a.organization.pk),
                f"memberships-{index}-user": str(membership.user_id),
                f"memberships-{index}-role": membership.role,
                # L'ancien caissier est retiré du commerce au passage.
                f"memberships-{index}-is_active": "" if membership.user == a.cashier else "on",
            }
        )
    new = len(memberships)
    data.update(
        {
            f"memberships-{new}-organization": str(a.organization.pk),
            f"memberships-{new}-user": str(newcomer.pk),
            f"memberships-{new}-role": Role.OWNER,
            f"memberships-{new}-is_active": "on",
        }
    )

    response = platform.post(
        reverse("admin:tenancy_organization_change", args=[a.organization.pk]), data
    )

    assert response.status_code == 302
    assert _groups(newcomer) == {"Propriétaire"}
    assert _staff(newcomer) is True
    assert _groups(a.cashier) == set()
