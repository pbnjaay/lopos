from uuid import uuid4

import pytest
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient


@pytest.mark.parametrize(
    ("route_name", "expected_path"),
    [
        ("store-list", "/api/v1/stores/"),
        ("cash-register-list", "/api/v1/cash-registers/"),
        ("product-list", "/api/v1/products/"),
        ("inventory-stock-in", "/api/v1/inventory/stock-in/"),
        ("cash-session-open", "/api/v1/cash-sessions/open/"),
        ("sale-complete", "/api/v1/sales/"),
    ],
)
def test_api_route(route_name: str, expected_path: str) -> None:
    assert reverse(route_name) == expected_path


def test_current_cash_session_route() -> None:
    register_id = uuid4()

    assert reverse(
        "cash-register-current-session",
        kwargs={"pk": register_id},
    ) == f"/api/v1/cash-registers/{register_id}/current-session/"


def test_session_login_route() -> None:
    assert reverse("rest_framework:login") == "/api/v1/auth/login/"


@pytest.mark.django_db
def test_api_requires_authentication() -> None:
    response = APIClient().get(reverse("product-list"))

    assert response.status_code == status.HTTP_403_FORBIDDEN
