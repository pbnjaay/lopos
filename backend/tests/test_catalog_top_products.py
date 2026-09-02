"""Classement des meilleures ventes servi au point de vente.

Le POS ne charge jamais le catalogue entier : il demande une liste courte,
classee par volume vendu. Ces tests verrouillent ce contrat — le plafond, le
classement, l'isolation par magasin et le repli sur un magasin sans historique.
"""

from datetime import timedelta
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from apps.cash.models import CashSession
from apps.catalog.models import Product
from apps.catalog.views import ProductViewSet
from apps.sales.models import Payment, Sale, SaleItem
from apps.stores.models import CashRegister, Store


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


def _sell(session: CashSession, cashier, product: Product, quantity: str) -> None:
    """Enregistre une vente d'une ligne, au plus simple."""
    unit_price = product.selling_price
    line_total = (unit_price * Decimal(quantity)).quantize(Decimal("0.01"))
    sale = Sale.objects.create(
        cash_session=session,
        cashier=cashier,
        subtotal=line_total,
        total=line_total,
        status=Sale.Status.COMPLETED,
    )
    Payment.objects.create(
        sale=sale,
        method=Payment.Method.CASH,
        amount=line_total,
        received_amount=line_total,
        change_amount=Decimal("0.00"),
    )
    SaleItem.objects.create(
        sale=sale,
        product=product,
        product_name=product.name,
        unit_price=unit_price,
        quantity=Decimal(quantity),
        line_total=line_total,
    )


@pytest.fixture
def shop(cashier):
    store = Store.objects.create(name="Supérette Test")
    register = CashRegister.objects.create(store=store, name="Caisse 01")
    session = CashSession.objects.create(
        cash_register=register,
        cashier=cashier,
        opening_balance=Decimal("10000.00"),
    )
    products = {
        name: Product.objects.create(name=name, selling_price=Decimal(price))
        for name, price in [
            ("Riz parfumé 5kg", "4800.00"),
            ("Coca 50cl", "500.00"),
            ("Banane", "700.00"),
        ]
    }
    return {"store": store, "session": session, "products": products}


def test_classe_par_quantite_vendue(api_client, shop, cashier):
    _sell(shop["session"], cashier, shop["products"]["Coca 50cl"], "10")
    _sell(shop["session"], cashier, shop["products"]["Banane"], "5")
    _sell(shop["session"], cashier, shop["products"]["Riz parfumé 5kg"], "1")

    response = api_client.get(
        reverse("product-top"), {"store_id": str(shop["store"].id)}
    )

    assert response.status_code == status.HTTP_200_OK
    assert [row["name"] for row in response.json()][:3] == [
        "Coca 50cl",
        "Banane",
        "Riz parfumé 5kg",
    ]


def test_plafonne_le_nombre_de_produits(api_client, shop, cashier):
    _sell(shop["session"], cashier, shop["products"]["Coca 50cl"], "10")

    response = api_client.get(
        reverse("product-top"), {"store_id": str(shop["store"].id), "limit": "2"}
    )

    assert response.status_code == status.HTTP_200_OK
    assert len(response.json()) == 2


def test_le_plafond_demande_ne_depasse_jamais_le_maximum(api_client, shop):
    response = api_client.get(
        reverse("product-top"),
        {"store_id": str(shop["store"].id), "limit": "10000"},
    )

    assert response.status_code == status.HTTP_200_OK
    assert len(response.json()) <= ProductViewSet.TOP_PRODUCTS_MAX_LIMIT


def test_magasin_sans_historique_reçoit_quand_meme_des_produits(api_client, shop):
    """Une caisse qui vient d'ouvrir ne doit pas afficher une grille vide."""
    response = api_client.get(
        reverse("product-top"), {"store_id": str(shop["store"].id), "limit": "3"}
    )

    assert response.status_code == status.HTTP_200_OK
    assert len(response.json()) == 3


def test_ignore_les_ventes_hors_fenetre(api_client, shop, cashier):
    _sell(shop["session"], cashier, shop["products"]["Coca 50cl"], "10")
    ancienne = Sale.objects.get()
    Sale.objects.filter(pk=ancienne.pk).update(
        occurred_at=timezone.now()
        - timedelta(days=ProductViewSet.TOP_PRODUCTS_WINDOW_DAYS + 1)
    )
    _sell(shop["session"], cashier, shop["products"]["Banane"], "1")

    response = api_client.get(
        reverse("product-top"), {"store_id": str(shop["store"].id), "limit": "1"}
    )

    assert response.status_code == status.HTTP_200_OK
    assert response.json()[0]["name"] == "Banane"


def test_ne_melange_pas_les_magasins(api_client, shop, cashier):
    autre_magasin = Store.objects.create(name="Autre boutique")
    _sell(shop["session"], cashier, shop["products"]["Coca 50cl"], "10")

    response = api_client.get(
        reverse("product-top"), {"store_id": str(autre_magasin.id), "limit": "1"}
    )

    assert response.status_code == status.HTTP_200_OK
    # Aucun historique sur ce magasin : on retombe sur le catalogue, pas sur
    # le classement du magasin voisin.
    assert response.json()[0]["name"] == "Banane"


def test_store_id_obligatoire(api_client):
    response = api_client.get(reverse("product-top"))

    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert "store_id" in response.json()


def test_limit_invalide_est_refusee(api_client, shop):
    response = api_client.get(
        reverse("product-top"), {"store_id": str(shop["store"].id), "limit": "zero"}
    )

    assert response.status_code == status.HTTP_400_BAD_REQUEST
