import pytest
from django.apps import apps
from django.conf import settings
from django.contrib import admin
from django.contrib.auth.models import Group, User
from django.urls import reverse
from unfold.admin import ModelAdmin

from apps.cash.models import CashSession
from apps.catalog.models import Product
from apps.inventory.models import InventoryMovement, Stock
from apps.sales.models import Payment, Sale, SaleItem
from apps.accounts.admin import StoreAssignmentInline
from apps.stores.models import CashRegister, Store, StoreAssignment


def test_unfold_is_loaded_before_django_admin() -> None:
    assert settings.INSTALLED_APPS.index("unfold") < settings.INSTALLED_APPS.index(
        "django.contrib.admin"
    )


@pytest.mark.parametrize(
    ("app_label", "label"),
    [
        ("accounts", "Comptes"),
        ("cash", "Caisse"),
        ("catalog", "Catalogue"),
        ("inventory", "Stocks"),
        ("sales", "Ventes"),
        ("stores", "Magasins"),
    ],
)
def test_application_labels_are_in_french(app_label, label) -> None:
    assert apps.get_app_config(app_label).verbose_name == label


@pytest.mark.parametrize(
    ("model", "singular", "plural"),
    [
        (Store, "magasin", "magasins"),
        (CashRegister, "caisse", "caisses"),
        (StoreAssignment, "affectation à un magasin", "affectations aux magasins"),
        (Product, "produit", "produits"),
        (Stock, "stock", "stocks"),
        (InventoryMovement, "mouvement de stock", "mouvements de stock"),
        (CashSession, "session de caisse", "sessions de caisse"),
        (Sale, "vente", "ventes"),
        (SaleItem, "article vendu", "articles vendus"),
        (Payment, "paiement", "paiements"),
    ],
)
def test_model_labels_are_in_french(model, singular, plural) -> None:
    assert model._meta.verbose_name == singular
    assert model._meta.verbose_name_plural == plural


@pytest.mark.parametrize(
    "model",
    [
        User,
        Group,
        Store,
        CashRegister,
        StoreAssignment,
        Product,
        Stock,
        InventoryMovement,
        CashSession,
        Sale,
        SaleItem,
        Payment,
    ],
)
def test_registered_admins_use_unfold(model) -> None:
    assert isinstance(admin.site._registry[model], ModelAdmin)


def test_store_assignments_are_managed_from_the_user_admin() -> None:
    assert StoreAssignmentInline in admin.site._registry[User].inlines


def test_sales_sidebar_links_to_returns() -> None:
    sales_section = next(
        section
        for section in settings.UNFOLD["SIDEBAR"]["navigation"]
        if str(section["title"]) == "Ventes"
    )
    returns_item = next(
        item for item in sales_section["items"] if str(item["title"]) == "Retours"
    )

    assert str(returns_item["link"]) == reverse("admin:sales_salereturn_changelist")


@pytest.mark.django_db
def test_admin_login_uses_unfold(client) -> None:
    response = client.get(reverse("admin:login"))

    assert response.status_code == 200
    assert "unfold" in response.content.decode().lower()
