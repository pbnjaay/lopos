import pytest
from django.conf import settings
from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient


pytestmark = pytest.mark.django_db
User = get_user_model()


@pytest.fixture
def user():
    return User.objects.create_user(
        username="cashier",
        password="Passer1234",
        email="cashier@example.com",
    )


@pytest.fixture
def csrf_client() -> APIClient:
    return APIClient(enforce_csrf_checks=True)


def _set_csrf_cookie(client: APIClient) -> str:
    response = client.get(reverse("auth-csrf"))

    assert response.status_code == status.HTTP_200_OK
    assert response.json() == {"detail": "CSRF cookie set"}
    assert "csrftoken" in response.cookies
    return client.cookies["csrftoken"].value


def _login(client: APIClient, *, username: str, password: str):
    csrf_token = _set_csrf_cookie(client)
    return client.post(
        reverse("auth-login"),
        {"username": username, "password": password},
        format="json",
        HTTP_X_CSRFTOKEN=csrf_token,
    )


def test_valid_login_returns_user_and_session_cookie(
    csrf_client: APIClient,
    user,
) -> None:
    response = _login(
        csrf_client,
        username=user.username,
        password="Passer1234",
    )

    assert response.status_code == status.HTTP_200_OK
    assert response.json() == {
        "id": user.pk,
        "username": "cashier",
        "email": "cashier@example.com",
        "first_name": "",
        "last_name": "",
        "is_staff": False,
    }
    assert settings.SESSION_COOKIE_NAME in csrf_client.cookies
    assert "csrftoken" in csrf_client.cookies


def test_invalid_login_returns_explicit_json_error(
    csrf_client: APIClient,
    user,
) -> None:
    response = _login(
        csrf_client,
        username=user.username,
        password="wrong-password",
    )

    assert response.status_code == status.HTTP_401_UNAUTHORIZED
    assert response.json() == {
        "code": "INVALID_CREDENTIALS",
        "message": "Nom d'utilisateur ou mot de passe incorrect.",
    }
    assert settings.SESSION_COOKIE_NAME not in csrf_client.cookies


def test_me_returns_authenticated_user(csrf_client: APIClient, user) -> None:
    login_response = _login(
        csrf_client,
        username=user.username,
        password="Passer1234",
    )
    assert login_response.status_code == status.HTTP_200_OK

    response = csrf_client.get(reverse("auth-me"))

    assert response.status_code == status.HTTP_200_OK
    assert response.json()["id"] == user.pk
    assert response.json()["username"] == user.username


def test_me_rejects_anonymous_user(csrf_client: APIClient) -> None:
    response = csrf_client.get(reverse("auth-me"))

    assert response.status_code == status.HTTP_403_FORBIDDEN
    assert response["Content-Type"].startswith("application/json")


def test_logout_clears_session_and_me_becomes_anonymous(
    csrf_client: APIClient,
    user,
) -> None:
    login_response = _login(
        csrf_client,
        username=user.username,
        password="Passer1234",
    )
    assert login_response.status_code == status.HTTP_200_OK
    rotated_csrf_token = csrf_client.cookies["csrftoken"].value

    response = csrf_client.post(
        reverse("auth-logout"),
        {},
        format="json",
        HTTP_X_CSRFTOKEN=rotated_csrf_token,
    )

    assert response.status_code == status.HTTP_200_OK
    assert response.json() == {"detail": "Logged out"}
    assert csrf_client.get(reverse("auth-me")).status_code == status.HTTP_403_FORBIDDEN


def test_login_without_csrf_returns_json_error(
    csrf_client: APIClient,
    user,
) -> None:
    response = csrf_client.post(
        reverse("auth-login"),
        {"username": user.username, "password": "Passer1234"},
        format="json",
    )

    assert response.status_code == status.HTTP_403_FORBIDDEN
    assert response.json()["code"] == "CSRF_FAILED"


def test_vite_origin_is_the_only_default_csrf_trusted_origin() -> None:
    assert settings.CSRF_TRUSTED_ORIGINS == ["http://localhost:5173"]
    assert settings.CSRF_COOKIE_HTTPONLY is False
    assert settings.CSRF_COOKIE_SAMESITE == "Lax"
    assert settings.SESSION_COOKIE_SAMESITE == "Lax"
