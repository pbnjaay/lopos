from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient

from apps.cash.models import CashSession
from apps.catalog.models import Product
from apps.inventory.models import InventoryMovement, Stock
from apps.sales.exceptions import InvalidCancellation
from apps.sales.models import Payment, Sale
from apps.sales.services import cancel_sale, complete_sale
from apps.stores.models import CashRegister, Store


pytestmark = pytest.mark.django_db
User = get_user_model()


@pytest.fixture
def cashier():
    return User.objects.create_user(username="cashier", password="secret")


@pytest.fixture
def other_cashier():
    return User.objects.create_user(username="other-cashier", password="secret")


@pytest.fixture
def store() -> Store:
    return Store.objects.create(name="Supérette Test")


@pytest.fixture
def cash_session(store: Store, cashier) -> CashSession:
    register = CashRegister.objects.create(store=store, name="Caisse 01")
    return CashSession.objects.create(
        cash_register=register, cashier=cashier, opening_balance=Decimal("15000.00")
    )


@pytest.fixture
def product(store: Store) -> Product:
    product = Product.objects.create(name="Coca 50cl", selling_price=Decimal("500.00"))
    Stock.objects.create(store=store, product=product, quantity=20)
    return product


@pytest.fixture
def sale(cash_session: CashSession, product: Product) -> Sale:
    return complete_sale(
        cash_session=cash_session,
        items=[{"product_id": product.id, "quantity": Decimal("3"), "unit_price": None}],
        payment_method=Payment.Method.CASH,
        received_amount=Decimal("2000.00"),
    )


def test_cancel_sale_restores_stock_and_creates_audit_record(
    sale: Sale, product: Product, store: Store
) -> None:
    cancel_sale(sale_id=sale.id, cancelled_by=sale.cashier)

    sale.refresh_from_db()
    assert sale.status == Sale.Status.CANCELLED
    assert Stock.objects.get(store=store, product=product).quantity == 20
    movement = InventoryMovement.objects.get(
        product=product, movement_type=InventoryMovement.Type.CANCELLATION
    )
    assert movement.quantity == Decimal("3.000")
    assert movement.reference == sale.id


def test_cannot_cancel_an_already_cancelled_sale(sale: Sale) -> None:
    cancel_sale(sale_id=sale.id, cancelled_by=sale.cashier)

    with pytest.raises(InvalidCancellation):
        cancel_sale(sale_id=sale.id, cancelled_by=sale.cashier)


def test_another_cashier_cannot_cancel_the_sale(sale: Sale, other_cashier) -> None:
    with pytest.raises(InvalidCancellation):
        cancel_sale(sale_id=sale.id, cancelled_by=other_cashier)


def test_owner_cannot_cancel_once_their_session_is_closed(
    sale: Sale, cash_session: CashSession
) -> None:
    cash_session.status = CashSession.Status.CLOSED
    cash_session.save(update_fields=["status"])

    with pytest.raises(InvalidCancellation):
        cancel_sale(sale_id=sale.id, cancelled_by=sale.cashier)


def test_staff_can_cancel_any_sale_regardless_of_session_state(
    sale: Sale, cash_session: CashSession
) -> None:
    cash_session.status = CashSession.Status.CLOSED
    cash_session.save(update_fields=["status"])
    manager = User.objects.create_user(username="gerant", is_staff=True)

    cancel_sale(sale_id=sale.id, cancelled_by=manager)

    sale.refresh_from_db()
    assert sale.status == Sale.Status.CANCELLED


class TestCancelSaleAPI:
    def test_owner_can_cancel_their_own_sale(self, sale: Sale) -> None:
        client = APIClient()
        client.force_authenticate(sale.cashier)

        response = client.post(reverse("sale-cancel", args=[sale.id]))

        assert response.status_code == status.HTTP_200_OK
        assert response.json()["status"] == "CANCELLED"

    def test_another_cashier_gets_a_conflict(self, sale: Sale, other_cashier) -> None:
        client = APIClient()
        client.force_authenticate(other_cashier)

        response = client.post(reverse("sale-cancel", args=[sale.id]))

        assert response.status_code == status.HTTP_409_CONFLICT
        assert response.json()["code"] == "INVALID_CANCELLATION"

    def test_unknown_sale_returns_404(self, cashier) -> None:
        client = APIClient()
        client.force_authenticate(cashier)

        response = client.post(
            reverse("sale-cancel", args=["11111111-1111-1111-1111-111111111111"])
        )

        assert response.status_code == status.HTTP_404_NOT_FOUND
        assert response.json()["code"] == "SALE_NOT_FOUND"
