import pytest
from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.urls import reverse

from apps.tenancy.roles import sync_member_access


pytestmark = pytest.mark.django_db
User = get_user_model()

RESTRICTED_FIELDS = {"is_staff", "is_superuser", "groups", "user_permissions"}


def _store_assignment_management_form() -> dict:
    return {
        "store_assignments-TOTAL_FORMS": "0",
        "store_assignments-INITIAL_FORMS": "0",
        "store_assignments-MIN_NUM_FORMS": "0",
        "store_assignments-MAX_NUM_FORMS": "1000",
    }


def _user_change_post_data(**overrides) -> dict:
    data = {
        "username": "caissier1",
        "first_name": "",
        "last_name": "",
        "email": "",
        "is_active": "on",
        "date_joined_0": "2024-01-01",
        "date_joined_1": "00:00:00",
        **_store_assignment_management_form(),
        "_save": "Save",
    }
    data.update(overrides)
    return data


@pytest.fixture
def owner(client) -> User:
    """Le propriétaire du commerce pilote : c'est lui qui gère les comptes."""
    call_command("create_default_groups")
    user = User.objects.create_user(username="proprietaire1", password="pass12345", is_staff=True)
    sync_member_access(user)
    client.login(username="proprietaire1", password="pass12345")
    return user


@pytest.fixture
def superuser_client(client) -> "django.test.Client":  # noqa: F821
    User.objects.create_superuser(
        username="root", email="root@example.com", password="pass12345"
    )
    client.login(username="root", password="pass12345")
    return client


@pytest.fixture
def cashier() -> User:
    return User.objects.create_user(username="caissier1", password="pass12345")


def test_superuser_still_sees_permission_fields(superuser_client, cashier) -> None:
    response = superuser_client.get(
        reverse("admin:auth_user_change", args=[cashier.pk])
    )

    content = response.content.decode()
    for field in RESTRICTED_FIELDS:
        assert f'name="{field}"' in content


def test_owner_does_not_see_permission_fields(client, owner, cashier) -> None:
    response = client.get(reverse("admin:auth_user_change", args=[cashier.pk]))

    content = response.content.decode()
    for field in RESTRICTED_FIELDS:
        assert f'name="{field}"' not in content
    assert 'name="is_active"' in content


def test_owner_cannot_self_elevate_a_cashier_via_forged_post(
    client, owner, cashier
) -> None:
    response = client.post(
        reverse("admin:auth_user_change", args=[cashier.pk]),
        _user_change_post_data(is_staff="on", is_superuser="on"),
    )

    assert response.status_code in (200, 302)
    cashier.refresh_from_db()
    assert cashier.is_staff is False
    assert cashier.is_superuser is False


def test_owner_cannot_open_a_superuser_account_for_edit(client, owner) -> None:
    superuser = User.objects.create_superuser(
        username="root", email="root@example.com", password="pass12345"
    )

    # Un super-utilisateur n'existe pas pour un commerce : introuvable, comme
    # un compte inconnu (Django renvoie alors vers l'accueil de l'admin).
    response = client.get(reverse("admin:auth_user_change", args=[superuser.pk]))
    assert response.status_code == 302

    post_response = client.post(
        reverse("admin:auth_user_change", args=[superuser.pk]),
        _user_change_post_data(username="hacked"),
    )
    assert post_response.status_code == 302
    superuser.refresh_from_db()
    assert superuser.username == "root"


def test_owner_can_reach_the_password_change_button_for_a_cashier(
    client, owner, cashier
) -> None:
    response = client.get(f"/admin/auth/user/{cashier.pk}/changer-mot-de-passe/")

    assert response.status_code == 302
    assert response["Location"] == reverse(
        "admin:auth_user_password_change", args=[cashier.pk]
    )


def test_owner_cannot_reset_a_superuser_password(client, owner) -> None:
    superuser = User.objects.create_superuser(
        username="root", email="root@example.com", password="pass12345"
    )

    response = client.get(f"/admin/auth/user/{superuser.pk}/changer-mot-de-passe/")

    assert response.status_code == 403


def test_manager_has_no_access_to_accounts(client) -> None:
    call_command("create_default_groups")
    manager = User.objects.create_user(username="gerant1", password="pass12345", is_staff=True)
    manager.memberships.update(role="MANAGER")
    sync_member_access(manager)
    client.login(username="gerant1", password="pass12345")

    assert client.get(reverse("admin:auth_user_changelist")).status_code == 403
    assert client.get(reverse("admin:stores_storeassignment_changelist")).status_code == 403
