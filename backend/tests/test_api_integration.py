from typing import Any

import pytest
from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient

from apps.catalog.models import Product
from apps.inventory.models import InventoryMovement, Stock
from apps.sales.models import Payment, Sale, SaleItem


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


def _bootstrap_pos(
    client: APIClient,
    *,
    stock_quantity: int = 20,
) -> dict[str, Any]:
    store_response = client.post(
        reverse("store-list"),
        {"name": "Supérette Test"},
        format="json",
    )
    assert store_response.status_code == status.HTTP_201_CREATED
    store = store_response.json()

    product_response = client.post(
        reverse("product-list"),
        {
            "name": "Coca 50cl",
            "barcode": "123456789",
            "selling_price": "500.00",
        },
        format="json",
    )
    assert product_response.status_code == status.HTTP_201_CREATED
    product = product_response.json()

    stock_response = client.post(
        reverse("inventory-stock-in"),
        {
            "store_id": store["id"],
            "product_id": product["id"],
            "quantity": stock_quantity,
        },
        format="json",
    )
    assert stock_response.status_code == status.HTTP_201_CREATED

    register_response = client.post(
        reverse("cash-register-list"),
        {
            "store_id": store["id"],
            "name": "Caisse 01",
        },
        format="json",
    )
    assert register_response.status_code == status.HTTP_201_CREATED
    cash_register = register_response.json()

    session_response = client.post(
        reverse("cash-session-open"),
        {
            "cash_register_id": cash_register["id"],
            "opening_balance": "15000.00",
        },
        format="json",
    )
    assert session_response.status_code == status.HTTP_201_CREATED

    return {
        "store": store,
        "product": product,
        "stock": stock_response.json(),
        "cash_register": cash_register,
        "cash_session": session_response.json(),
    }


def test_complete_pos_scenario_through_api(
    api_client: APIClient,
    cashier,
) -> None:
    context = _bootstrap_pos(api_client)

    assert context["stock"] == {
        "product_id": context["product"]["id"],
        "store_id": context["store"]["id"],
        "quantity_added": "20.000",
        "current_stock": "20.000",
    }
    assert context["cash_session"]["cashier_id"] == cashier.pk
    assert context["cash_session"]["opening_balance"] == "15000.00"
    assert context["cash_session"]["status"] == "OPEN"

    sale_response = api_client.post(
        reverse("sale-complete"),
        {
            "cash_session_id": context["cash_session"]["id"],
            "items": [
                {
                    "product_id": context["product"]["id"],
                    "quantity": 2,
                }
            ],
            "payment": {
                "method": "CASH",
                "received_amount": "2000.00",
            },
        },
        format="json",
    )

    assert sale_response.status_code == status.HTTP_201_CREATED
    sale_data = sale_response.json()
    assert sale_data["status"] == "COMPLETED"
    assert sale_data["subtotal"] == "1000.00"
    assert sale_data["discount"] == "0.00"
    assert sale_data["total"] == "1000.00"
    assert sale_data["payment"] == {
        "method": "CASH",
        "amount": "1000.00",
        "received_amount": "2000.00",
        "change_amount": "1000.00",
    }
    assert sale_data["items"] == [
        {
            "id": sale_data["items"][0]["id"],
            "product_id": context["product"]["id"],
            "product_name": "Coca 50cl",
            "sale_unit": "UNIT",
            "catalog_unit_price": "500.00",
            "unit_price": "500.00",
            "quantity": "2.000",
            "line_total": "1000.00",
            "quantity_returned": "0.000",
            "quantity_returnable": "2.000",
        }
    ]

    product_response = api_client.get(
        reverse("product-list"),
        {
            "barcode": "123456789",
            "store_id": context["store"]["id"],
        },
    )
    assert product_response.status_code == status.HTTP_200_OK
    assert product_response.json()[0]["stock"] == "18.000"

    session_response = api_client.get(
        reverse(
            "cash-register-current-session",
            kwargs={"pk": context["cash_register"]["id"]},
        )
    )
    assert session_response.status_code == status.HTTP_200_OK
    assert session_response.json()["id"] == context["cash_session"]["id"]

    assert Sale.objects.count() == 1
    assert SaleItem.objects.count() == 1
    assert Payment.objects.count() == 1
    assert Stock.objects.get().quantity == 18
    movement = InventoryMovement.objects.get(
        movement_type=InventoryMovement.Type.SALE
    )
    assert movement.quantity == -2
    assert str(movement.reference) == sale_data["id"]


def test_product_search_returns_matching_product_and_store_stock(
    api_client: APIClient,
) -> None:
    context = _bootstrap_pos(api_client)

    response = api_client.get(
        reverse("product-list"),
        {"search": "cOcA", "store_id": context["store"]["id"]},
    )

    assert response.status_code == status.HTTP_200_OK
    assert response.json()[0]["name"] == "Coca 50cl"
    assert response.json()[0]["stock"] == "20.000"


def test_double_cash_session_opening_returns_business_error(
    api_client: APIClient,
) -> None:
    context = _bootstrap_pos(api_client)

    response = api_client.post(
        reverse("cash-session-open"),
        {
            "cash_register_id": context["cash_register"]["id"],
            "opening_balance": "10000.00",
        },
        format="json",
    )

    assert response.status_code == status.HTTP_409_CONFLICT
    assert response.json()["code"] == "CASH_SESSION_ALREADY_OPEN"


def test_insufficient_cash_rolls_back_api_sale(api_client: APIClient) -> None:
    context = _bootstrap_pos(api_client)

    response = api_client.post(
        reverse("sale-complete"),
        {
            "cash_session_id": context["cash_session"]["id"],
            "items": [
                {"product_id": context["product"]["id"], "quantity": 2}
            ],
            "payment": {"method": "CASH", "received_amount": "500.00"},
        },
        format="json",
    )

    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert response.json()["code"] == "INVALID_SALE"
    assert Sale.objects.count() == 0
    assert Payment.objects.count() == 0
    assert Stock.objects.get().quantity == 20
    assert not InventoryMovement.objects.filter(
        movement_type=InventoryMovement.Type.SALE
    ).exists()


def test_insufficient_stock_rolls_back_api_sale(api_client: APIClient) -> None:
    context = _bootstrap_pos(api_client, stock_quantity=1)

    response = api_client.post(
        reverse("sale-complete"),
        {
            "cash_session_id": context["cash_session"]["id"],
            "items": [
                {"product_id": context["product"]["id"], "quantity": 2}
            ],
            "payment": {"method": "CASH", "received_amount": "2000.00"},
        },
        format="json",
    )

    assert response.status_code == status.HTTP_409_CONFLICT
    assert response.json() == {
        "code": "INSUFFICIENT_STOCK",
        "message": "Stock insuffisant pour Coca 50cl.",
    }
    assert Sale.objects.count() == 0
    assert Stock.objects.get().quantity == 1


def test_cashier_cannot_sell_on_another_cashiers_session(
    api_client: APIClient,
) -> None:
    context = _bootstrap_pos(api_client)
    other_cashier = User.objects.create_user(username="other-cashier")
    api_client.force_authenticate(other_cashier)

    response = api_client.post(
        reverse("sale-complete"),
        {
            "cash_session_id": context["cash_session"]["id"],
            "items": [
                {"product_id": context["product"]["id"], "quantity": 1}
            ],
            "payment": {"method": "WAVE"},
        },
        format="json",
    )

    assert response.status_code == status.HTTP_403_FORBIDDEN
    assert response.json()["code"] == "CASH_SESSION_NOT_OWNED"
    assert Sale.objects.count() == 0
    assert Stock.objects.get().quantity == 20


def test_inactive_product_returns_business_error(api_client: APIClient) -> None:
    context = _bootstrap_pos(api_client)
    Product.objects.filter(pk=context["product"]["id"]).update(is_active=False)

    response = api_client.post(
        reverse("sale-complete"),
        {
            "cash_session_id": context["cash_session"]["id"],
            "items": [
                {"product_id": context["product"]["id"], "quantity": 1}
            ],
            "payment": {"method": "WAVE"},
        },
        format="json",
    )

    assert response.status_code == status.HTTP_409_CONFLICT
    assert response.json()["code"] == "PRODUCT_INACTIVE"
    assert Sale.objects.count() == 0
    assert Stock.objects.get().quantity == 20


def test_current_session_returns_404_when_register_has_no_open_session(
    api_client: APIClient,
) -> None:
    store_response = api_client.post(
        reverse("store-list"),
        {"name": "Supérette Test"},
        format="json",
    )
    register_response = api_client.post(
        reverse("cash-register-list"),
        {"store_id": store_response.json()["id"], "name": "Caisse 01"},
        format="json",
    )

    response = api_client.get(
        reverse(
            "cash-register-current-session",
            kwargs={"pk": register_response.json()["id"]},
        )
    )

    assert response.status_code == status.HTTP_404_NOT_FOUND
