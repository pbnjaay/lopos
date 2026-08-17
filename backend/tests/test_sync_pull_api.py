from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient

from apps.catalog.models import Product

pytestmark = pytest.mark.django_db
User = get_user_model()


@pytest.fixture
def cashier():
    return User.objects.create_user(username="cashier", password="secret")


@pytest.fixture
def api_client(cashier) -> APIClient:
    client = APIClient()
    client.force_authenticate(cashier)
    return client


def test_pull_without_cursor_returns_full_catalog(api_client: APIClient) -> None:
    coca = Product.objects.create(name="Coca 50cl", selling_price=Decimal("500.00"))
    pain = Product.objects.create(name="Pain", selling_price=Decimal("300.00"))

    response = api_client.get(reverse("sync-pull"))

    assert response.status_code == status.HTTP_200_OK
    body = response.json()
    changes_by_id = {change["id"]: change for change in body["changes"]}
    assert set(changes_by_id) == {str(coca.id), str(pain.id)}
    assert changes_by_id[str(coca.id)]["type"] == "PRODUCT_UPSERT"
    assert changes_by_id[str(coca.id)]["data"] == {
        "name": "Coca 50cl",
        "barcode": None,
        "selling_price": "500.00",
        "is_active": True,
    }
    assert "cursor" in body


def test_pull_with_cursor_only_returns_changes_since(api_client: APIClient) -> None:
    Product.objects.create(name="Coca 50cl", selling_price=Decimal("500.00"))
    first_response = api_client.get(reverse("sync-pull"))
    cursor = first_response.json()["cursor"]

    pain = Product.objects.create(name="Pain", selling_price=Decimal("300.00"))
    second_response = api_client.get(reverse("sync-pull"), {"cursor": cursor})

    body = second_response.json()
    assert [change["id"] for change in body["changes"]] == [str(pain.id)]


def test_pull_reports_price_change_since_cursor(api_client: APIClient) -> None:
    product = Product.objects.create(name="Coca 50cl", selling_price=Decimal("500.00"))
    first_response = api_client.get(reverse("sync-pull"))
    cursor = first_response.json()["cursor"]

    product.selling_price = Decimal("600.00")
    product.save(update_fields=["selling_price", "updated_at"])

    second_response = api_client.get(reverse("sync-pull"), {"cursor": cursor})
    body = second_response.json()
    assert len(body["changes"]) == 1
    assert body["changes"][0]["data"]["selling_price"] == "600.00"


def test_pull_reports_deactivation_as_upsert_with_is_active_false(
    api_client: APIClient,
) -> None:
    product = Product.objects.create(name="Coca 50cl", selling_price=Decimal("500.00"))
    first_response = api_client.get(reverse("sync-pull"))
    cursor = first_response.json()["cursor"]

    product.is_active = False
    product.save(update_fields=["is_active", "updated_at"])

    second_response = api_client.get(reverse("sync-pull"), {"cursor": cursor})
    change = second_response.json()["changes"][0]
    assert change["type"] == "PRODUCT_UPSERT"
    assert change["data"]["is_active"] is False


def test_pull_second_call_with_final_cursor_returns_nothing_new(
    api_client: APIClient,
) -> None:
    Product.objects.create(name="Coca 50cl", selling_price=Decimal("500.00"))
    first_response = api_client.get(reverse("sync-pull"))
    cursor = first_response.json()["cursor"]

    second_response = api_client.get(reverse("sync-pull"), {"cursor": cursor})

    assert second_response.json()["changes"] == []


def test_pull_rejects_invalid_cursor(api_client: APIClient) -> None:
    response = api_client.get(reverse("sync-pull"), {"cursor": "not-a-date"})

    assert response.status_code == status.HTTP_400_BAD_REQUEST


def test_pull_requires_authentication() -> None:
    anonymous_client = APIClient()

    response = anonymous_client.get(reverse("sync-pull"))

    assert response.status_code == status.HTTP_403_FORBIDDEN
