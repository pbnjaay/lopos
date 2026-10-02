"""Le super-utilisateur est la plateforme, jamais un utilisateur du POS —
même rattaché par erreur à un commerce."""

from io import StringIO

import pytest
from django import forms
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.core.management import call_command
from django.urls import reverse
from rest_framework.test import APIClient

from apps.accounts.admin import MemberChangeForm
from apps.stores.access import (
    cash_registers_accessible_to,
    stores_accessible_to,
    user_can_manage_store,
)
from apps.stores.models import CashRegister, Store
from apps.tenancy.context import resolve_tenant
from apps.tenancy.models import Organization, OrganizationMembership

pytestmark = [pytest.mark.django_db, pytest.mark.explicit_tenancy]
User = get_user_model()
PASSWORD = "Passer1234"


@pytest.fixture
def two_commerces():
    own = Organization.objects.create(name="Boutique A", slug="boutique-a")
    other = Organization.objects.create(name="Boutique B", slug="boutique-b")
    own_store = Store.objects.create(name="Magasin A", organization=own)
    other_store = Store.objects.create(name="Magasin B", organization=other)
    CashRegister.objects.create(store=own_store, name="Caisse A")
    CashRegister.objects.create(store=other_store, name="Caisse B")
    return own, own_store, other_store


@pytest.fixture
def superuser_member(two_commerces):
    """Le cas d'erreur d'opérateur : une plateforme rattachée à un commerce
    (créé sans validation, comme par un script ou une donnée ancienne)."""
    own, _, _ = two_commerces
    admin = User.objects.create_superuser(username="platform", password=PASSWORD)
    OrganizationMembership.objects.create(
        organization=own, user=admin, role=OrganizationMembership.Role.OWNER
    )
    return admin


def test_a_superuser_never_gets_a_tenant(superuser_member) -> None:
    assert resolve_tenant(superuser_member) is None


def test_store_access_helpers_give_a_superuser_nothing(superuser_member, two_commerces) -> None:
    _, own_store, other_store = two_commerces

    assert not stores_accessible_to(superuser_member).exists()
    assert not cash_registers_accessible_to(superuser_member).exists()
    assert not user_can_manage_store(superuser_member, own_store.pk)
    assert not user_can_manage_store(superuser_member, other_store.pk)


def test_a_superuser_member_cannot_open_a_pos_session(superuser_member) -> None:
    response = APIClient().post(
        reverse("auth-login"), {"username": "platform", "password": PASSWORD}, format="json"
    )

    assert response.status_code == 403
    assert response.json()["code"] == "NO_ACTIVE_MEMBERSHIP"


def test_a_logged_in_superuser_member_sees_no_store_of_any_commerce(superuser_member) -> None:
    client = APIClient()
    client.force_authenticate(superuser_member)

    for name in ("store-list", "cash-register-list"):
        assert client.get(reverse(name)).status_code == 403


def test_a_superuser_cannot_be_made_member_of_a_commerce(two_commerces) -> None:
    own, _, _ = two_commerces
    admin = User.objects.create_superuser(username="platform", password=PASSWORD)
    membership = OrganizationMembership(
        organization=own, user=admin, role=OrganizationMembership.Role.MANAGER
    )

    with pytest.raises(ValidationError) as excinfo:
        membership.full_clean()

    assert "user" in excinfo.value.message_dict


def test_a_member_cannot_be_promoted_superuser_by_the_platform(two_commerces) -> None:
    own, _, _ = two_commerces
    member = User.objects.create_user(username="gerant", password=PASSWORD)
    OrganizationMembership.objects.create(
        organization=own, user=member, role=OrganizationMembership.Role.MANAGER
    )
    form = MemberChangeForm(instance=member)
    form.cleaned_data = {"is_superuser": True}

    with pytest.raises(forms.ValidationError):
        form.clean_is_superuser()


def test_audit_flags_a_superuser_member(superuser_member) -> None:
    output = StringIO()
    call_command("tenancy_audit", stdout=output)

    assert "platform est super-utilisateur et membre d'un commerce" in output.getvalue()
