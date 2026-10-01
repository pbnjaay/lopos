from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction

from apps.catalog.models import Product
from apps.expenses.models import ExpenseCategory
from apps.stores.models import Store
from apps.tenancy.models import Organization, OrganizationMembership

pytestmark = [pytest.mark.django_db, pytest.mark.explicit_tenancy]
User = get_user_model()
Role = OrganizationMembership.Role


@pytest.fixture
def organization() -> Organization:
    return Organization.objects.create(name="Boutique Ndiaye", slug="ndiaye")


@pytest.fixture
def user():
    return User.objects.create_user(username="awa")


def test_organization_is_active_by_default(organization: Organization) -> None:
    assert organization.status == Organization.Status.ACTIVE


def test_organization_slug_is_unique(organization: Organization) -> None:
    with pytest.raises(IntegrityError), transaction.atomic():
        Organization.objects.create(name="Autre", slug="ndiaye")


def test_organization_name_cannot_be_empty() -> None:
    with pytest.raises(IntegrityError), transaction.atomic():
        Organization.objects.create(name="", slug="vide")


def test_organization_status_is_constrained(organization: Organization) -> None:
    with pytest.raises(IntegrityError), transaction.atomic():
        Organization.objects.filter(pk=organization.pk).update(status="DELETED")


def test_membership_is_unique_per_organization(organization: Organization, user) -> None:
    OrganizationMembership.objects.create(organization=organization, user=user, role=Role.CASHIER)

    with pytest.raises(IntegrityError), transaction.atomic():
        OrganizationMembership.objects.create(
            organization=organization, user=user, role=Role.MANAGER, is_active=False
        )


def test_user_has_at_most_one_active_membership(organization: Organization, user) -> None:
    other = Organization.objects.create(name="Autre commerce", slug="autre")
    OrganizationMembership.objects.create(organization=organization, user=user, role=Role.CASHIER)

    with pytest.raises(IntegrityError), transaction.atomic():
        OrganizationMembership.objects.create(organization=other, user=user, role=Role.CASHIER)


def test_inactive_membership_does_not_block_another_organization(
    organization: Organization, user
) -> None:
    other = Organization.objects.create(name="Autre commerce", slug="autre")
    OrganizationMembership.objects.create(
        organization=organization, user=user, role=Role.CASHIER, is_active=False
    )

    membership = OrganizationMembership.objects.create(
        organization=other, user=user, role=Role.OWNER
    )

    assert membership.is_active


def test_membership_role_is_constrained(organization: Organization, user) -> None:
    with pytest.raises(IntegrityError), transaction.atomic():
        OrganizationMembership.objects.create(organization=organization, user=user, role="ADMIN")


def test_organization_with_stores_cannot_be_deleted(organization: Organization) -> None:
    Store.objects.create(name="Louga Centre", organization=organization)

    with pytest.raises(IntegrityError), transaction.atomic():
        Organization.objects.filter(pk=organization.pk).delete()


def test_sole_is_none_without_organization() -> None:
    assert Organization.objects.sole() is None


def test_sole_returns_the_only_organization(organization: Organization) -> None:
    assert Organization.objects.sole() == organization


def test_sole_is_none_once_a_second_organization_exists(organization: Organization) -> None:
    Organization.objects.create(name="Autre commerce", slug="autre")

    assert Organization.objects.sole() is None


def _create_store() -> Store:
    return Store.objects.create(name="Louga Centre")


def _create_product() -> Product:
    return Product.objects.create(name="Riz 1kg", selling_price=Decimal("700"))


def _create_category() -> ExpenseCategory:
    return ExpenseCategory.objects.create(name="Loyer")


@pytest.mark.parametrize("create", [_create_store, _create_product, _create_category])
def test_record_without_organization_is_refused_even_with_a_single_one(
    organization: Organization, create
) -> None:
    """Plus aucun rattachement deviné : la colonne est obligatoire, et le
    code doit toujours dire à quel commerce appartient ce qu'il crée."""
    with pytest.raises(IntegrityError), transaction.atomic():
        create()


def test_organization_is_kept_as_given(organization: Organization) -> None:
    other = Organization.objects.create(name="Autre commerce", slug="autre")

    store = Store.objects.create(name="Dakar", organization=other)

    assert store.organization == other
