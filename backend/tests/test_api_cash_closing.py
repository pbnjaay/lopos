from decimal import Decimal
from typing import Any

import pytest
from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient

from apps.catalog.models import Product
from apps.inventory.models import InventoryMovement
from apps.sales.models import Payment, Sale, SaleItem
from apps.stores.models import StoreAssignment


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


def _bootstrap_pos(client: APIClient, *, stock_quantity: int = 20) -> dict[str, Any]:
    store = client.post(
        reverse("store-list"), {"name": "Supérette Test"}, format="json"
    ).json()
    StoreAssignment.objects.create(
        user=User.objects.get(username="cashier"),
        store_id=store["id"],
    )
    product = client.post(
        reverse("product-list"),
        {"name": "Coca 50cl", "barcode": "123456789", "selling_price": "500.00"},
        format="json",
    ).json()
    client.post(
        reverse("inventory-stock-in"),
        {"store_id": store["id"], "product_id": product["id"], "quantity": stock_quantity},
        format="json",
    )
    cash_register = client.post(
        reverse("cash-register-list"),
        {"store_id": store["id"], "name": "Caisse 01"},
        format="json",
    ).json()
    cash_session = client.post(
        reverse("cash-session-open"),
        {"cash_register_id": cash_register["id"], "opening_balance": "15000.00"},
        format="json",
    ).json()
    return {
        "store": store,
        "product": product,
        "cash_register": cash_register,
        "cash_session": cash_session,
    }


def _sell(
    client: APIClient,
    *,
    cash_session_id: str,
    product_id: str,
    quantity: int,
    method: str,
    price: Decimal,
) -> dict[str, Any]:
    payment: dict[str, Any] = {"method": method}
    if method == "CASH":
        payment["received_amount"] = str(price * quantity)

    response = client.post(
        reverse("sale-complete"),
        {
            "cash_session_id": cash_session_id,
            "items": [{"product_id": product_id, "quantity": quantity}],
            "payment": payment,
        },
        format="json",
    )
    assert response.status_code == status.HTTP_201_CREATED, response.json()
    return response.json()


def _seed_reference_scenario(client: APIClient, context: dict[str, Any]) -> None:
    cash_session_id = context["cash_session"]["id"]
    product_id = context["product"]["id"]
    price = Decimal("500.00")

    # Cash sales totalling 15000 (30 units), Wave totalling 20000 (40 units),
    # Orange Money totalling 8000 (16 units).
    _sell(client, cash_session_id=cash_session_id, product_id=product_id, quantity=30, method="CASH", price=price)
    _sell(client, cash_session_id=cash_session_id, product_id=product_id, quantity=40, method="WAVE", price=price)
    _sell(client, cash_session_id=cash_session_id, product_id=product_id, quantity=16, method="ORANGE_MONEY", price=price)


def test_summary_reports_correct_totals(api_client: APIClient) -> None:
    context = _bootstrap_pos(api_client, stock_quantity=200)
    _seed_reference_scenario(api_client, context)

    response = api_client.get(
        reverse("cash-session-summary", kwargs={"pk": context["cash_session"]["id"]})
    )

    assert response.status_code == status.HTTP_200_OK
    data = response.json()
    assert data["status"] == "OPEN"
    assert data["sales_count"] == 3
    assert data["gross_sales"] == "43000.00"
    assert data["payments"] == {
        "cash": "15000.00",
        "wave": "20000.00",
        "orange_money": "8000.00",
    }
    assert data["opening_balance"] == "15000.00"
    assert data["expected_cash"] == "30000.00"
    assert data["counted_cash"] is None
    assert data["cash_difference"] is None
    assert data["closed_at"] is None
    assert data["cash_register"]["id"] == context["cash_register"]["id"]


def test_close_recomputes_totals_and_reports_shortage(api_client: APIClient) -> None:
    context = _bootstrap_pos(api_client, stock_quantity=200)
    _seed_reference_scenario(api_client, context)

    response = api_client.post(
        reverse("cash-session-close", kwargs={"pk": context["cash_session"]["id"]}),
        {"counted_cash": "29500.00"},
        format="json",
    )

    assert response.status_code == status.HTTP_200_OK
    data = response.json()
    assert data["status"] == "CLOSED"
    assert data["expected_cash"] == "30000.00"
    assert data["counted_cash"] == "29500.00"
    assert data["cash_difference"] == "-500.00"
    assert data["closed_at"] is not None
    assert data["sales_count"] == 3
    assert data["gross_sales"] == "43000.00"


def test_close_ignores_client_supplied_totals(api_client: APIClient) -> None:
    context = _bootstrap_pos(api_client, stock_quantity=200)
    _seed_reference_scenario(api_client, context)

    response = api_client.post(
        reverse("cash-session-close", kwargs={"pk": context["cash_session"]["id"]}),
        {
            "counted_cash": "29500.00",
            "expected_cash": "999999.00",
            "gross_sales": "1.00",
            "sales_count": 1,
            "cash_difference": "0.00",
        },
        format="json",
    )

    assert response.status_code == status.HTTP_200_OK
    data = response.json()
    assert data["expected_cash"] == "30000.00"
    assert data["gross_sales"] == "43000.00"
    assert data["sales_count"] == 3
    assert data["cash_difference"] == "-500.00"


def test_close_rejects_negative_counted_cash(api_client: APIClient) -> None:
    context = _bootstrap_pos(api_client)

    response = api_client.post(
        reverse("cash-session-close", kwargs={"pk": context["cash_session"]["id"]}),
        {"counted_cash": "-1"},
        format="json",
    )

    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert response.json() == {
        "code": "INVALID_COUNTED_CASH",
        "message": "Le montant compté doit être un montant exact positif ou nul.",
    }


def test_close_twice_is_rejected(api_client: APIClient) -> None:
    context = _bootstrap_pos(api_client)

    first = api_client.post(
        reverse("cash-session-close", kwargs={"pk": context["cash_session"]["id"]}),
        {"counted_cash": "15000.00"},
        format="json",
    )
    assert first.status_code == status.HTTP_200_OK

    second = api_client.post(
        reverse("cash-session-close", kwargs={"pk": context["cash_session"]["id"]}),
        {"counted_cash": "15000.00"},
        format="json",
    )

    assert second.status_code == status.HTTP_409_CONFLICT
    assert second.json()["code"] == "CASH_SESSION_ALREADY_CLOSED"


def test_sale_rejected_after_close(api_client: APIClient) -> None:
    context = _bootstrap_pos(api_client)

    api_client.post(
        reverse("cash-session-close", kwargs={"pk": context["cash_session"]["id"]}),
        {"counted_cash": "15000.00"},
        format="json",
    )

    response = api_client.post(
        reverse("sale-complete"),
        {
            "cash_session_id": context["cash_session"]["id"],
            "items": [{"product_id": context["product"]["id"], "quantity": 1}],
            "payment": {"method": "WAVE"},
        },
        format="json",
    )

    assert response.status_code == status.HTTP_409_CONFLICT
    assert response.json()["code"] == "CASH_SESSION_CLOSED"
    assert Sale.objects.count() == 0
    assert SaleItem.objects.count() == 0
    assert Payment.objects.count() == 0
    assert not InventoryMovement.objects.filter(
        movement_type=InventoryMovement.Type.SALE
    ).exists()


def test_current_session_is_forbidden_for_another_cashier(
    api_client: APIClient,
) -> None:
    context = _bootstrap_pos(api_client)
    other_cashier = User.objects.create_user(username="other-current-session-cashier")
    StoreAssignment.objects.create(
        user=other_cashier,
        store_id=context["store"]["id"],
    )
    api_client.force_authenticate(other_cashier)

    response = api_client.get(
        reverse(
            "cash-register-current-session",
            kwargs={"pk": context["cash_register"]["id"]},
        )
    )

    assert response.status_code == status.HTTP_403_FORBIDDEN
    assert response.json() == {
        "code": "CASH_SESSION_NOT_OWNED",
        "message": "Cette session appartient à un autre caissier.",
    }


def test_summary_and_close_are_forbidden_for_another_cashier(api_client: APIClient) -> None:
    context = _bootstrap_pos(api_client)
    other_cashier = User.objects.create_user(username="other-cashier")
    api_client.force_authenticate(other_cashier)

    summary_response = api_client.get(
        reverse("cash-session-summary", kwargs={"pk": context["cash_session"]["id"]})
    )
    close_response = api_client.post(
        reverse("cash-session-close", kwargs={"pk": context["cash_session"]["id"]}),
        {"counted_cash": "15000.00"},
        format="json",
    )

    assert summary_response.status_code == status.HTTP_403_FORBIDDEN
    assert summary_response.json()["code"] == "CASH_SESSION_NOT_OWNED"
    assert close_response.status_code == status.HTTP_403_FORBIDDEN
    assert close_response.json()["code"] == "CASH_SESSION_NOT_OWNED"


def test_sale_detail_returns_full_ticket_data(api_client: APIClient) -> None:
    context = _bootstrap_pos(api_client)
    sale = _sell(
        api_client,
        cash_session_id=context["cash_session"]["id"],
        product_id=context["product"]["id"],
        quantity=2,
        method="CASH",
        price=Decimal("500.00"),
    )

    response = api_client.get(reverse("sale-detail", kwargs={"pk": sale["id"]}))

    assert response.status_code == status.HTTP_200_OK
    data = response.json()
    assert data["store"] == {"id": context["store"]["id"], "name": "Supérette Test"}
    assert data["cash_register"] == {
        "id": context["cash_register"]["id"],
        "name": "Caisse 01",
    }
    assert data["cashier"]["username"] == "cashier"
    assert data["items"] == [
        {
            "id": data["items"][0]["id"],
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
    assert data["payment"]["method"] == "CASH"


def test_sale_detail_keeps_historical_price_after_product_price_change(
    api_client: APIClient,
) -> None:
    context = _bootstrap_pos(api_client)
    sale = _sell(
        api_client,
        cash_session_id=context["cash_session"]["id"],
        product_id=context["product"]["id"],
        quantity=1,
        method="WAVE",
        price=Decimal("500.00"),
    )

    Product.objects.filter(pk=context["product"]["id"]).update(selling_price=Decimal("600.00"))

    response = api_client.get(reverse("sale-detail", kwargs={"pk": sale["id"]}))

    assert response.status_code == status.HTTP_200_OK
    data = response.json()
    assert data["items"][0]["unit_price"] == "500.00"
    assert data["total"] == "500.00"


def test_sale_detail_is_forbidden_for_another_cashier(api_client: APIClient) -> None:
    context = _bootstrap_pos(api_client)
    sale = _sell(
        api_client,
        cash_session_id=context["cash_session"]["id"],
        product_id=context["product"]["id"],
        quantity=1,
        method="WAVE",
        price=Decimal("500.00"),
    )
    other_cashier = User.objects.create_user(username="other-cashier")
    api_client.force_authenticate(other_cashier)

    response = api_client.get(reverse("sale-detail", kwargs={"pk": sale["id"]}))

    assert response.status_code == status.HTTP_403_FORBIDDEN
    assert response.json()["code"] == "SALE_NOT_OWNED"
