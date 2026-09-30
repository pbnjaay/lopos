"""Le coût d'achat ne sort jamais vers qui n'a pas à le voir.

- le POS (API produits) ne reçoit jamais de prix d'achat ;
- dans l'admin, coût moyen et coût des mouvements suivent la permission de
  la page Valorisation.
"""

from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission
from django.urls import reverse
from rest_framework.test import APIClient

from apps.catalog.models import Product
from apps.inventory.models import InventoryMovement, Stock
from apps.inventory.services import receive_stock
from apps.stores.models import Store


pytestmark = pytest.mark.django_db
User = get_user_model()


@pytest.fixture
def store() -> Store:
    return Store.objects.create(name="Supérette Louga")


@pytest.fixture
def product(store: Store) -> Product:
    product = Product.objects.create(
        name="Coca 50cl", selling_price=Decimal("500"), purchase_price=Decimal("350")
    )
    receive_stock(store=store, product=product, quantity=24, unit_cost=Decimal("350"))
    return product


def _staff(client, *codenames: str):
    user = User.objects.create_user(username="staff", password="pass1234", is_staff=True)
    user.user_permissions.add(*Permission.objects.filter(codename__in=codenames))
    client.force_login(user)
    return user


# --- API du POS -----------------------------------------------------------------


def test_pos_product_api_never_returns_the_purchase_price(store: Store, product: Product) -> None:
    api = APIClient()
    api.force_authenticate(User.objects.create_user(username="caissier"))

    listed = api.get(reverse("product-list"), {"store_id": str(store.pk)}).json()
    detail = api.get(reverse("product-detail", args=[product.pk])).json()

    assert listed and "purchase_price" not in listed[0]
    assert "purchase_price" not in detail
    assert "average_unit_cost" not in detail


def test_product_created_through_the_api_still_keeps_its_purchase_price() -> None:
    api = APIClient()
    api.force_authenticate(User.objects.create_user(username="gerant"))

    response = api.post(
        reverse("product-list"),
        {"name": "Fanta", "selling_price": "500.00", "purchase_price": "320.00"},
        format="json",
    )

    assert response.status_code == 201
    assert "purchase_price" not in response.json()
    assert Product.objects.get(name="Fanta").purchase_price == Decimal("320.00")


# --- Réception et ajustement de stock -------------------------------------------


def test_stock_pages_hide_the_average_cost_without_valuation_access(
    client, store: Store, product: Product
) -> None:
    _staff(client, "change_product", "view_product")

    response = client.get(reverse("admin:catalog_product_receive_stock", args=[product.pk]))

    content = response.content.decode()
    assert response.status_code == 200
    assert "Coût moyen" not in content
    # Il saisit bien le prix d'achat de ce qu'il réceptionne.
    assert 'name="unit_cost"' in content


def test_receipt_message_hides_the_average_cost_without_valuation_access(
    client, store: Store, product: Product
) -> None:
    _staff(client, "change_product", "view_product")

    response = client.post(
        reverse("admin:catalog_product_receive_stock", args=[product.pk]),
        {"store": str(store.pk), "quantity": "6", "unit_cost": "400"},
        follow=True,
    )

    content = response.content.decode()
    assert "Nouveau stock : 30.000." in content
    assert "coût moyen :" not in content
    # Le coût moyen est quand même tenu à jour : (24 × 350 + 6 × 400) / 30.
    assert Stock.objects.get(store=store, product=product).average_unit_cost == Decimal("360.0000")


def test_stock_pages_show_the_average_cost_with_valuation_access(
    client, store: Store, product: Product
) -> None:
    _staff(client, "change_product", "view_product", "view_stockvaluation")

    response = client.get(reverse("admin:catalog_product_adjust_stock", args=[product.pk]))

    content = response.content.decode()
    assert "Coût moyen" in content
    assert "350 FCFA" in content


# --- Mouvements de stock -------------------------------------------------------------


def test_movements_hide_their_cost_without_valuation_access(
    client, store: Store, product: Product
) -> None:
    _staff(client, "view_inventorymovement")
    movement = InventoryMovement.objects.get()

    listing = client.get(reverse("admin:inventory_inventorymovement_changelist"))
    detail = client.get(reverse("admin:inventory_inventorymovement_change", args=[movement.pk]))

    assert listing.status_code == 200
    assert "coût unitaire" not in listing.content.decode().lower()
    assert "350 FCFA" not in listing.content.decode()
    assert detail.status_code == 200
    assert "coût unitaire" not in detail.content.decode().lower()


def test_movements_show_their_cost_with_valuation_access(
    client, store: Store, product: Product
) -> None:
    _staff(client, "view_inventorymovement", "view_stockvaluation")

    listing = client.get(reverse("admin:inventory_inventorymovement_changelist"))

    assert "350 FCFA" in listing.content.decode()
