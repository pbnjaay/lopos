"""Finitions de l'admin : français partout, pastilles de statut, colonnes utiles."""

from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.urls import reverse
from django.utils import translation

from apps.catalog.models import Product
from apps.inventory.models import Stock
from apps.stores.models import Store


pytestmark = pytest.mark.django_db
User = get_user_model()


@pytest.fixture
def admin_client(client):
    client.force_login(User.objects.create_superuser(username="admin", password="x"))
    return client


@pytest.fixture
def store() -> Store:
    return Store.objects.create(name="Supérette Louga")


# --- Français ---------------------------------------------------------------------


@pytest.mark.parametrize(
    "english, french",
    [
        ("Type to search", "Rechercher…"),
        ("Search apps and models...", "Rechercher une page…"),
        ("Reset filters", "Réinitialiser les filtres"),
        ("No results found", "Aucun résultat"),
    ],
)
def test_unfold_strings_are_translated(english: str, french: str) -> None:
    with translation.override("fr"):
        assert translation.gettext(english) == french


def test_admin_pages_have_no_english_left(admin_client, store: Store) -> None:
    dashboard = admin_client.get(reverse("admin:index")).content.decode()
    stock_list = admin_client.get(reverse("admin:inventory_stock_changelist")).content.decode()

    for content in (dashboard, stock_list):
        assert "Search apps and models" not in content
        assert "Type to search" not in content
    assert "Rechercher une page…" in dashboard
    assert "Rechercher…" in stock_list


def test_admin_home_is_titled_as_the_dashboard(admin_client) -> None:
    response = admin_client.get(reverse("admin:index"))

    assert response.context["title"] == "Tableau de bord"
    assert "Site d’administration" not in response.content.decode()


# --- Pastilles de statut --------------------------------------------------------------


def test_stock_status_is_a_colored_badge(admin_client, store: Store) -> None:
    product = Product.objects.create(name="Coca 50cl", selling_price=Decimal("500"))
    Stock.objects.create(store=store, product=product, quantity=0)

    content = admin_client.get(reverse("admin:inventory_stock_changelist")).content.decode()

    # Pastille « danger » d'Unfold autour de « Rupture ».
    badge = content[content.index("Rupture") - 400 : content.index("Rupture")]
    assert "bg-red-100" in badge


# --- Colonne magasin ------------------------------------------------------------------


def test_store_column_is_hidden_while_there_is_a_single_store(admin_client, store: Store) -> None:
    product = Product.objects.create(name="Coca 50cl", selling_price=Decimal("500"))
    Stock.objects.create(store=store, product=product, quantity=5)

    response = admin_client.get(reverse("admin:inventory_stock_changelist"))

    assert "store" not in response.context["cl"].list_display


def test_store_column_comes_back_with_a_second_store(admin_client, store: Store) -> None:
    Store.objects.create(name="Boutique Médina", is_active=False)

    response = admin_client.get(reverse("admin:inventory_stock_changelist"))

    assert "store" in response.context["cl"].list_display


def test_uncolored_status_shows_its_french_label_not_its_code(store: Store) -> None:
    from django.contrib import admin

    from apps.cash.admin import CashSessionAdmin
    from apps.cash.models import CashSession
    from apps.stores.models import CashRegister

    register = CashRegister.objects.create(store=store, name="Caisse 01")
    session = CashSession.objects.create(
        cash_register=register,
        cashier=User.objects.create_user(username="caissier"),
        opening_balance=Decimal("1000"),
    )
    model_admin = CashSessionAdmin(CashSession, admin.site)

    # Ouverte : pastille colorée (clé, libellé).
    assert model_admin.status_display(session) == ("OPEN", CashSession.Status.OPEN.label)
    # Clôturée, sans couleur : le libellé seul, jamais le code « CLOSED ».
    session.status = CashSession.Status.CLOSED
    assert model_admin.status_display(session) == CashSession.Status.CLOSED.label


def test_stock_list_breadcrumb_matches_the_sidebar(admin_client, store: Store) -> None:
    response = admin_client.get(reverse("admin:inventory_stock_changelist"))

    content = response.content.decode()
    assert "État du stock" in content
    # Plus de « Stocks › Stocks » : l'application s'appelle « Stock ».
    assert ">\n        Stocks\n        </" not in content
    assert Stock._meta.app_config.verbose_name == "Stock"
    assert Stock._meta.verbose_name_plural == "état du stock"


@pytest.mark.parametrize(
    "url_name, section, list_name",
    [
        ("admin:sales_sale_changelist", "Ventes", "Tickets de vente"),
        ("admin:expenses_expense_changelist", "Dépenses", "Dépenses saisies"),
    ],
)
def test_list_names_differ_from_their_section(admin_client, url_name, section, list_name) -> None:
    response = admin_client.get(reverse(url_name))

    opts = response.context["cl"].opts
    assert opts.app_config.verbose_name == section
    assert opts.verbose_name_plural.capitalize() == list_name
    assert list_name in response.content.decode()
