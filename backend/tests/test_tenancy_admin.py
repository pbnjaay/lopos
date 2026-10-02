import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.management import call_command
from django.urls import reverse

from apps.stores.models import Store
from apps.tenancy.models import Organization, OrganizationMembership

pytestmark = [pytest.mark.django_db, pytest.mark.explicit_tenancy]
User = get_user_model()

CHANGELIST = "admin:tenancy_organization_changelist"


@pytest.fixture
def organization() -> Organization:
    organization = Organization.objects.create(name="Boutique Ndiaye", slug="ndiaye")
    Store.objects.create(name="Louga Centre", organization=organization)
    return organization


@pytest.fixture
def superuser_client(client):
    User.objects.create_superuser(username="plateforme", password="pass12345")
    client.login(username="plateforme", password="pass12345")
    return client


@pytest.fixture
def manager_client(client, organization: Organization):
    call_command("create_default_groups")
    user = User.objects.create_user(username="gerant", password="pass12345", is_staff=True)
    user.groups.add(Group.objects.get(name="Gérant"))
    OrganizationMembership.objects.create(
        organization=organization, user=user, role=OrganizationMembership.Role.MANAGER
    )
    client.login(username="gerant", password="pass12345")
    return client


def test_superuser_lists_organizations_with_counts(
    superuser_client, organization: Organization
) -> None:
    OrganizationMembership.objects.create(
        organization=organization,
        user=User.objects.create_user(username="awa"),
        role=OrganizationMembership.Role.OWNER,
    )

    response = superuser_client.get(reverse(CHANGELIST))

    assert response.status_code == 200
    assert response.context["cl"].result_count == 1
    row = response.context["cl"].result_list[0]
    assert (row._store_count, row._member_count) == (1, 1)


def test_superuser_opens_an_organization(superuser_client, organization: Organization) -> None:
    response = superuser_client.get(
        reverse("admin:tenancy_organization_change", args=[organization.pk])
    )

    assert response.status_code == 200
    assert b"Louga Centre" in response.content


def test_superuser_adds_a_member_and_is_recorded_as_its_creator(
    superuser_client, organization: Organization
) -> None:
    awa = User.objects.create_user(username="awa")
    store = organization.stores.get()

    response = superuser_client.post(
        reverse("admin:tenancy_organization_change", args=[organization.pk]),
        {
            "name": organization.name,
            "slug": organization.slug,
            "status": Organization.Status.ACTIVE,
            "stores-TOTAL_FORMS": "1",
            "stores-INITIAL_FORMS": "1",
            "stores-MIN_NUM_FORMS": "0",
            "stores-MAX_NUM_FORMS": "1000",
            "stores-0-id": str(store.pk),
            "stores-0-organization": str(organization.pk),
            "memberships-TOTAL_FORMS": "1",
            "memberships-INITIAL_FORMS": "0",
            "memberships-MIN_NUM_FORMS": "0",
            "memberships-MAX_NUM_FORMS": "1000",
            "memberships-0-user": str(awa.pk),
            "memberships-0-role": OrganizationMembership.Role.OWNER,
            "memberships-0-is_active": "on",
            "_save": "Save",
        },
    )

    assert response.status_code == 302, response.context and response.context.get("errors")
    membership = OrganizationMembership.objects.get(user=awa)
    assert membership.organization == organization
    assert membership.role == OrganizationMembership.Role.OWNER
    assert membership.created_by.username == "plateforme"


def test_organizations_are_hidden_from_managers(
    manager_client, organization: Organization
) -> None:
    assert manager_client.get(reverse(CHANGELIST)).status_code == 403
    assert (
        manager_client.get(
            reverse("admin:tenancy_organization_change", args=[organization.pk])
        ).status_code
        == 403
    )


def test_sidebar_shows_organizations_to_superusers_only(
    superuser_client, organization: Organization
) -> None:
    link = reverse(CHANGELIST).encode()

    assert link in superuser_client.get(reverse("admin:index")).content


def test_sidebar_hides_organizations_from_managers(manager_client) -> None:
    response = manager_client.get(reverse("admin:index"))

    assert response.status_code == 200
    assert reverse(CHANGELIST).encode() not in response.content


def test_organization_cannot_be_deleted_from_admin(
    superuser_client, organization: Organization
) -> None:
    response = superuser_client.get(
        reverse("admin:tenancy_organization_delete", args=[organization.pk])
    )

    assert response.status_code == 403
