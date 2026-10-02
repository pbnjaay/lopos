"""Frein aux tentatives de connexion répétées (`apps.accounts.login_guard`)."""

import pytest
from django.contrib.auth import get_user_model
from django.test import Client, override_settings
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient

from apps.accounts import login_guard

pytestmark = pytest.mark.django_db
User = get_user_model()

PASSWORD = "Passer1234"


@pytest.fixture
def cashier(pilot_organization):
    return User.objects.create_user(username="cashier", password=PASSWORD)


def _api_login(username: str, password: str, *, ip: str = "203.0.113.10"):
    return APIClient().post(
        reverse("auth-login"),
        {"username": username, "password": password},
        format="json",
        REMOTE_ADDR=ip,
    )


def _fail(times: int, username: str = "cashier", *, ip: str = "203.0.113.10") -> None:
    for _ in range(times):
        assert _api_login(username, "wrong-password", ip=ip).status_code == 401


def test_repeated_failures_block_the_pair_even_with_the_right_password(cashier) -> None:
    _fail(login_guard.MAX_FAILURES_PER_USERNAME_AND_IP)

    response = _api_login("cashier", PASSWORD)

    assert response.status_code == status.HTTP_429_TOO_MANY_REQUESTS
    assert response.json()["code"] == "TOO_MANY_LOGIN_ATTEMPTS"
    assert int(response["Retry-After"]) == login_guard.WINDOW_SECONDS
    assert "sessionid" not in response.cookies


def test_failures_from_one_address_do_not_lock_the_owner_elsewhere(cashier) -> None:
    _fail(login_guard.MAX_FAILURES_PER_USERNAME_AND_IP, ip="198.51.100.66")

    assert _api_login("cashier", PASSWORD, ip="203.0.113.10").status_code == 200


def test_an_address_trying_many_usernames_is_blocked(cashier) -> None:
    for index in range(login_guard.MAX_FAILURES_PER_IP):
        _fail(1, username=f"guess-{index}")

    assert _api_login("cashier", PASSWORD).status_code == 429
    assert _api_login("cashier", PASSWORD, ip="192.0.2.1").status_code == 200


def test_one_account_attacked_from_many_addresses_is_eventually_slowed(cashier) -> None:
    for index in range(login_guard.MAX_FAILURES_PER_USERNAME):
        _fail(1, ip=f"10.0.{index // 250}.{index % 250}")

    assert _api_login("cashier", PASSWORD, ip="192.0.2.1").status_code == 429


def test_a_successful_login_resets_the_pair_counter(cashier) -> None:
    _fail(login_guard.MAX_FAILURES_PER_USERNAME_AND_IP - 1)
    assert _api_login("cashier", PASSWORD).status_code == 200

    _fail(login_guard.MAX_FAILURES_PER_USERNAME_AND_IP - 1)
    assert _api_login("cashier", PASSWORD).status_code == 200


def test_usernames_are_counted_case_insensitively(cashier) -> None:
    _fail(login_guard.MAX_FAILURES_PER_USERNAME_AND_IP - 1, username="CASHIER")
    _fail(1, username="Cashier")

    assert _api_login("cashier", PASSWORD).status_code == 429


@override_settings(LOGIN_GUARD_TRUSTED_PROXY_COUNT=1)
def test_behind_the_proxy_the_address_added_by_the_proxy_counts(cashier) -> None:
    client = APIClient()
    for _ in range(login_guard.MAX_FAILURES_PER_USERNAME_AND_IP):
        # Le client invente une adresse à gauche ; le proxy ajoute la vraie.
        client.post(
            reverse("auth-login"),
            {"username": "cashier", "password": "wrong-password"},
            format="json",
            REMOTE_ADDR="10.0.0.1",
            HTTP_X_FORWARDED_FOR="1.2.3.4, 203.0.113.10",
        )

    blocked = client.post(
        reverse("auth-login"),
        {"username": "cashier", "password": PASSWORD},
        format="json",
        REMOTE_ADDR="10.0.0.1",
        HTTP_X_FORWARDED_FOR="9.9.9.9, 203.0.113.10",
    )
    other_client = client.post(
        reverse("auth-login"),
        {"username": "cashier", "password": PASSWORD},
        format="json",
        REMOTE_ADDR="10.0.0.1",
        HTTP_X_FORWARDED_FOR="203.0.113.99",
    )

    assert blocked.status_code == 429
    assert other_client.status_code == 200


def test_admin_login_is_guarded_too(pilot_organization) -> None:
    User.objects.create_superuser(username="platform", password=PASSWORD)
    client = Client()
    url = reverse("admin:login")

    for _ in range(login_guard.MAX_FAILURES_PER_USERNAME_AND_IP):
        response = client.post(url, {"username": "platform", "password": "nope"})
        assert response.status_code == 200

    blocked = client.post(url, {"username": "platform", "password": PASSWORD})

    assert blocked.status_code == 429
    assert "_auth_user_id" not in client.session


def test_admin_login_still_works_and_resets_the_counter(pilot_organization) -> None:
    User.objects.create_superuser(username="platform", password=PASSWORD)
    client = Client()
    url = reverse("admin:login")
    for _ in range(login_guard.MAX_FAILURES_PER_USERNAME_AND_IP - 1):
        client.post(url, {"username": "platform", "password": "nope"})

    response = client.post(url, {"username": "platform", "password": PASSWORD})

    assert response.status_code == 302
    assert client.session["_auth_user_id"]
