"""Phase 8 : accueillir un commerce pilote, le suspendre, le réactiver."""

from io import StringIO

import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import Client
from django.urls import reverse
from rest_framework.test import APIClient

from apps.expenses.models import ExpenseCategory
from apps.stores.models import CashRegister, Store
from apps.tenancy.models import Organization, OrganizationMembership
from apps.tenancy.onboarding import temporary_password

pytestmark = [pytest.mark.django_db, pytest.mark.explicit_tenancy]
User = get_user_model()


def _create_pilot(*args: str) -> str:
    out = StringIO()
    call_command(
        "create_pilot",
        "--name", "Boutique Ndiaye",
        "--store", "Louga Centre",
        "--owner", "ndiaye.awa",
        "--owner-first-name", "Awa",
        *args,
        stdout=out,
    )
    return out.getvalue()


def _printed_password(output: str) -> str:
    line = next(line for line in output.splitlines() if "Mot de passe temporaire" in line)
    return line.rsplit(" ", 1)[-1]


def test_create_pilot_sets_up_a_working_commerce() -> None:
    output = _create_pilot()

    organization = Organization.objects.get()
    assert (organization.name, organization.slug, organization.status) == (
        "Boutique Ndiaye",
        "boutique-ndiaye",
        Organization.Status.ACTIVE,
    )
    store = Store.objects.get()
    assert store.organization == organization
    assert CashRegister.objects.get().store == store
    assert ExpenseCategory.objects.filter(organization=organization).count() == 8
    owner = User.objects.get(username="ndiaye.awa")
    assert owner.first_name == "Awa"
    assert owner.memberships.get().role == OrganizationMembership.Role.OWNER
    assert set(owner.groups.values_list("name", flat=True)) == {"Propriétaire"}
    assert owner.is_staff
    assert owner.check_password(_printed_password(output))


def test_new_owner_logs_in_to_the_register_and_the_back_office() -> None:
    password = _printed_password(_create_pilot())

    api = APIClient()
    response = api.post(
        reverse("auth-login"), {"username": "ndiaye.awa", "password": password}, format="json"
    )
    admin_client = Client()
    admin_client.login(username="ndiaye.awa", password=password)

    assert response.status_code == 200
    assert response.json()["role"] == "OWNER"
    assert response.json()["store_ids"] == [str(Store.objects.get().pk)]
    assert admin_client.get(reverse("admin:index")).status_code == 200
    assert admin_client.get(reverse("admin:auth_user_add")).status_code == 200


def test_create_pilot_options() -> None:
    _create_pilot("--slug", "ndiaye", "--no-register")

    assert Organization.objects.get().slug == "ndiaye"
    assert not CashRegister.objects.exists()


def test_create_pilot_creates_the_role_groups_if_missing() -> None:
    assert not Group.objects.exists()

    _create_pilot()

    assert Group.objects.get(name="Propriétaire").permissions.exists()
    assert User.objects.get(username="ndiaye.awa").has_perm("auth.add_user")


@pytest.mark.parametrize(
    ("args", "message"),
    [
        (("--slug", "pris"), "déjà l'identifiant « pris »"),
        (("--owner", "deja.la"), "« deja.la » est déjà pris"),
    ],
)
def test_create_pilot_refuses_conflicts_and_creates_nothing(args, message) -> None:
    Organization.objects.create(name="Autre", slug="pris")
    User.objects.create_user(username="deja.la")

    with pytest.raises(CommandError, match=message):
        _create_pilot(*args)

    assert Organization.objects.count() == 1
    assert not Store.objects.exists()
    assert not ExpenseCategory.objects.exists()


def test_two_pilots_never_see_each_other() -> None:
    password_a = _printed_password(_create_pilot())
    call_command(
        "create_pilot",
        "--name", "Supérette Fall",
        "--store", "Dakar Plateau",
        "--owner", "fall.moussa",
        stdout=StringIO(),
    )
    api = APIClient()
    api.post(reverse("auth-login"), {"username": "ndiaye.awa", "password": password_a}, format="json")

    stores = [store["name"] for store in api.get(reverse("store-list")).json()]
    categories = api.get(reverse("expense-category-list")).json()

    assert stores == ["Louga Centre"]
    assert len(categories) == 8
    assert {c.organization.slug for c in ExpenseCategory.objects.all()} == {
        "boutique-ndiaye",
        "superette-fall",
    }
    call_command("tenancy_check", stdout=StringIO())


def test_temporary_passwords_are_long_and_never_repeat() -> None:
    passwords = {temporary_password() for _ in range(50)}

    assert len(passwords) == 50
    assert all(len(password) >= 17 for password in passwords)


# --- Fiche Organisation de la plateforme -------------------------------------


@pytest.fixture
def platform() -> Client:
    client = Client()
    client.force_login(User.objects.create_superuser(username="plateforme"))
    return client


def _formsets() -> dict:
    return {
        f"{prefix}-{field}": value
        for prefix in ("stores", "memberships")
        for field, value in (
            ("TOTAL_FORMS", "0"),
            ("INITIAL_FORMS", "0"),
            ("MIN_NUM_FORMS", "0"),
            ("MAX_NUM_FORMS", "1000"),
        )
    }


def test_commerce_created_from_the_admin_gets_its_default_categories(platform) -> None:
    response = platform.post(
        reverse("admin:tenancy_organization_add"),
        {"name": "Boutique Sow", "slug": "sow", "status": "ACTIVE", **_formsets()},
    )

    assert response.status_code == 302
    assert ExpenseCategory.objects.filter(organization__slug="sow").count() == 8


def test_suspending_closes_the_commerce_and_reactivating_reopens_it(platform) -> None:
    password = _printed_password(_create_pilot())
    organization = Organization.objects.get()
    changelist = reverse("admin:tenancy_organization_changelist")

    def owner_login_status() -> int:
        return (
            APIClient()
            .post(reverse("auth-login"), {"username": "ndiaye.awa", "password": password}, format="json")
            .status_code
        )

    platform.post(changelist, {"action": "suspend", "_selected_action": [organization.pk]})
    organization.refresh_from_db()
    assert organization.status == Organization.Status.SUSPENDED
    assert owner_login_status() == 403

    platform.post(changelist, {"action": "reactivate", "_selected_action": [organization.pk]})
    organization.refresh_from_db()
    assert organization.status == Organization.Status.ACTIVE
    assert owner_login_status() == 200
