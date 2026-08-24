from decimal import Decimal
from uuid import uuid4

import pytest
from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient

from apps.cash.models import CashSession
from apps.sales.models import Payment, Sale
from apps.stores.models import CashRegister, Store


pytestmark = pytest.mark.django_db
User = get_user_model()


def _session(*, user, store_name: str, register_name: str) -> CashSession:
    store = Store.objects.create(name=store_name)
    register = CashRegister.objects.create(store=store, name=register_name)
    return CashSession.objects.create(
        cash_register=register,
        cashier=user,
        opening_balance=Decimal("10000.00"),
    )


def _sale(*, session: CashSession, cashier=None, total: str = "1000.00") -> Sale:
    sale = Sale.objects.create(
        cash_session=session,
        cashier=cashier or session.cashier,
        subtotal=Decimal(total),
        discount=Decimal("0.00"),
        total=Decimal(total),
        status=Sale.Status.COMPLETED,
    )
    Payment.objects.create(
        sale=sale,
        method=Payment.Method.WAVE,
        amount=sale.total,
    )
    return sale


def test_admin_sales_history_is_scoped_to_the_store_of_selected_session() -> None:
    admin = User.objects.create_user(username="admin", is_staff=True, is_superuser=True)
    session_a = _session(user=admin, store_name="Boutique A", register_name="Caisse A")
    session_b = _session(user=admin, store_name="Boutique B", register_name="Caisse B")
    sale_a = _sale(session=session_a, total="1000.00")
    sale_b = _sale(session=session_b, total="2000.00")
    client = APIClient()
    client.force_authenticate(admin)

    response_a = client.get(reverse("sale-complete"), {"cash_session_id": session_a.id})
    response_b = client.get(reverse("sale-complete"), {"cash_session_id": session_b.id})

    assert response_a.status_code == status.HTTP_200_OK
    assert [row["id"] for row in response_a.json()["results"]] == [str(sale_a.id)]
    assert response_a.json()["results"][0]["store"]["name"] == "Boutique A"
    assert [row["id"] for row in response_b.json()["results"]] == [str(sale_b.id)]
    assert response_b.json()["results"][0]["store"]["name"] == "Boutique B"


def test_sale_detail_cannot_cross_the_store_boundary_even_for_admin() -> None:
    admin = User.objects.create_user(username="admin", is_staff=True, is_superuser=True)
    session_a = _session(user=admin, store_name="Boutique A", register_name="Caisse A")
    session_b = _session(user=admin, store_name="Boutique B", register_name="Caisse B")
    sale_b = _sale(session=session_b)
    client = APIClient()
    client.force_authenticate(admin)

    response = client.get(
        reverse("sale-detail", kwargs={"pk": sale_b.id}),
        {"cash_session_id": session_a.id},
    )

    assert response.status_code == status.HTTP_404_NOT_FOUND


def test_cashier_can_see_a_colleagues_sale_in_the_same_store() -> None:
    first_cashier = User.objects.create_user(username="first")
    second_cashier = User.objects.create_user(username="second")
    store = Store.objects.create(name="Boutique commune")
    first_register = CashRegister.objects.create(store=store, name="Caisse 01")
    second_register = CashRegister.objects.create(store=store, name="Caisse 02")
    first_session = CashSession.objects.create(
        cash_register=first_register,
        cashier=first_cashier,
        opening_balance=Decimal("0.00"),
    )
    second_session = CashSession.objects.create(
        cash_register=second_register,
        cashier=second_cashier,
        opening_balance=Decimal("0.00"),
    )
    colleague_sale = _sale(session=first_session)
    client = APIClient()
    client.force_authenticate(second_cashier)

    response = client.get(
        reverse("sale-detail", kwargs={"pk": colleague_sale.id}),
        {"cash_session_id": second_session.id},
    )

    assert response.status_code == status.HTTP_200_OK
    assert response.json()["cashier"]["username"] == "first"


def test_staff_cannot_use_another_users_open_session_as_pos_context() -> None:
    admin = User.objects.create_user(username="admin", is_staff=True, is_superuser=True)
    cashier = User.objects.create_user(username="cashier")
    cashier_session = _session(
        user=cashier,
        store_name="Boutique caissier",
        register_name="Caisse 01",
    )
    _sale(session=cashier_session)
    client = APIClient()
    client.force_authenticate(admin)

    response = client.get(
        reverse("sale-complete"),
        {"cash_session_id": cashier_session.id},
    )

    assert response.status_code == status.HTTP_403_FORBIDDEN
    assert response.json()["code"] == "OPEN_CASH_SESSION_REQUIRED"


def test_sales_history_requires_an_unambiguous_open_session() -> None:
    admin = User.objects.create_user(username="admin", is_staff=True, is_superuser=True)
    _session(user=admin, store_name="Boutique A", register_name="Caisse A")
    _session(user=admin, store_name="Boutique B", register_name="Caisse B")
    client = APIClient()
    client.force_authenticate(admin)

    response = client.get(reverse("sale-complete"))

    assert response.status_code == status.HTTP_403_FORBIDDEN
    assert response.json()["code"] == "OPEN_CASH_SESSION_REQUIRED"


def test_admin_cannot_return_a_sale_from_another_store_session() -> None:
    admin = User.objects.create_user(username="admin", is_staff=True, is_superuser=True)
    session_a = _session(user=admin, store_name="Boutique A", register_name="Caisse A")
    session_b = _session(user=admin, store_name="Boutique B", register_name="Caisse B")
    sale_b = _sale(session=session_b)
    client = APIClient()
    client.force_authenticate(admin)

    response = client.post(
        reverse("sale-return-list"),
        {
            "sale_id": sale_b.id,
            "cash_session_id": session_a.id,
            "idempotency_key": uuid4(),
            "payment_method": Payment.Method.WAVE,
            "items": [
                {
                    "sale_item_id": uuid4(),
                    "quantity": "1.000",
                    "restock": True,
                }
            ],
        },
        format="json",
    )

    assert response.status_code == status.HTTP_409_CONFLICT
    assert response.json()["code"] == "INVALID_RETURN"
    assert response.json()["message"] == "Le retour doit être effectué dans le magasin de la vente."
