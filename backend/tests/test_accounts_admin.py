import pytest
from django.contrib.auth.models import Group
from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.urls import reverse


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
def gerant(client) -> User:
    call_command("create_default_groups")
    manager_group = Group.objects.get(name="Gérant")
    user = User.objects.create_user(username="gerant1", password="pass12345", is_staff=True)
    user.groups.add(manager_group)
    client.login(username="gerant1", password="pass12345")
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


def test_manager_does_not_see_permission_fields(client, gerant, cashier) -> None:
    response = client.get(reverse("admin:auth_user_change", args=[cashier.pk]))

    content = response.content.decode()
    for field in RESTRICTED_FIELDS:
        assert f'name="{field}"' not in content
    assert 'name="is_active"' in content


def test_manager_cannot_self_elevate_a_cashier_via_forged_post(
    client, gerant, cashier
) -> None:
    response = client.post(
        reverse("admin:auth_user_change", args=[cashier.pk]),
        _user_change_post_data(is_staff="on", is_superuser="on"),
    )

    assert response.status_code in (200, 302)
    cashier.refresh_from_db()
    assert cashier.is_staff is False
    assert cashier.is_superuser is False


def test_manager_cannot_open_a_superuser_account_for_edit(client, gerant) -> None:
    superuser = User.objects.create_superuser(
        username="root", email="root@example.com", password="pass12345"
    )

    response = client.get(reverse("admin:auth_user_change", args=[superuser.pk]))
    assert response.status_code == 200  # visible, read-only

    post_response = client.post(
        reverse("admin:auth_user_change", args=[superuser.pk]),
        _user_change_post_data(username="root"),
    )
    assert post_response.status_code == 403


def test_manager_can_reach_the_password_change_button_for_a_cashier(
    client, gerant, cashier
) -> None:
    response = client.get(f"/admin/auth/user/{cashier.pk}/changer-mot-de-passe/")

    assert response.status_code == 302
    assert response["Location"] == reverse(
        "admin:auth_user_password_change", args=[cashier.pk]
    )


def test_manager_cannot_reset_a_superuser_password(client, gerant) -> None:
    superuser = User.objects.create_superuser(
        username="root", email="root@example.com", password="pass12345"
    )

    response = client.get(f"/admin/auth/user/{superuser.pk}/changer-mot-de-passe/")

    assert response.status_code == 403
