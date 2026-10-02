from decimal import Decimal

import pytest
from django.conf import settings
from django.contrib import admin
from django.urls import reverse

from apps.customers.services import create_customer, record_opening_balance
from apps.sales.admin import SaleAdmin
from apps.sales.models import Sale
from apps.stores.models import Store


pytestmark = pytest.mark.django_db


def test_sidebar_navigation_groups_models_by_business_task() -> None:
    navigation = settings.UNFOLD["SIDEBAR"]["navigation"]
    titles = [str(group["title"]) for group in navigation if group["title"]]

    assert titles == [
        "Catalogue",
        "Stock",
        "Caisses",
        "Ventes",
        "Cahier clients",
        "Dépenses",
        "Configuration",
    ]
    assert settings.UNFOLD["SIDEBAR"]["show_all_applications"] is False


def test_sidebar_does_not_link_technical_models() -> None:
    navigation = settings.UNFOLD["SIDEBAR"]["navigation"]
    all_links = [
        str(item["link"])
        for group in navigation
        for item in group["items"]
    ]

    assert not any("saleitem" in link for link in all_links)
    # Les lignes de paiement d'une vente sont techniques (vues en inline) ;
    # les paiements clients du cahier, eux, sont un écran métier.
    assert not any("/sales/payment/" in link for link in all_links)
    assert not any("processedsyncevent" in link for link in all_links)


def test_dashboard_callback_is_configured() -> None:
    assert (
        settings.UNFOLD["DASHBOARD_CALLBACK"]
        == "apps.dashboard.views.manager_dashboard_callback"
    )


def test_sale_page_is_read_as_its_ticket() -> None:
    model_admin = SaleAdmin(Sale, admin.site)

    # Articles et paiements sont dans le ticket en tête de fiche, pas en tableaux.
    assert model_admin.change_form_outer_before_template == "admin/sales/sale_summary.html"
    assert model_admin.inlines == ()


def test_admin_index_renders_manager_dashboard(client, django_user_model) -> None:
    user = django_user_model.objects.create_superuser(
        username="gerant", password="pw", email="gerant@example.com"
    )
    client.force_login(user)

    response = client.get(reverse("admin:index"))

    assert response.status_code == 200
    content = response.content.decode()
    assert "Panier moyen" in content
    assert "Rien à signaler" in content
    assert "Toutes les applications" not in content


def test_admin_index_shows_the_customer_book_once_used(client, django_user_model) -> None:
    user = django_user_model.objects.create_superuser(
        username="gerant", password="pw", email="gerant@example.com"
    )
    client.force_login(user)
    customer = create_customer(store=Store.objects.create(name="Boutique"), name="Moussa", phone="771234567")
    record_opening_balance(customer=customer, amount=Decimal("18500"))

    content = client.get(reverse("admin:index")).content.decode()

    assert "Cahier clients" in content
    assert "Encours total" in content
    assert "18 500 FCFA" in content


def test_admin_index_shows_expenses_apart_from_sales(client, django_user_model) -> None:
    from uuid import uuid4

    from apps.cash.models import CashSession
    from apps.expenses.models import ExpenseCategory
    from apps.expenses.services import create_expense, ensure_default_categories
    from apps.stores.models import CashRegister

    user = django_user_model.objects.create_superuser(
        username="gerant", password="pw", email="gerant@example.com"
    )
    client.force_login(user)
    ensure_default_categories()
    session = CashSession.objects.create(
        cash_register=CashRegister.objects.create(store=Store.objects.create(name="Boutique"), name="Caisse"),
        cashier=user,
        opening_balance=Decimal("50000"),
    )
    create_expense(
        cash_session=session,
        created_by=user,
        category=ExpenseCategory.objects.get(name="Électricité"),
        amount=Decimal("25000"),
        payment_method="CASH",
        idempotency_key=uuid4(),
    )

    content = client.get(reverse("admin:index")).content.decode()

    assert "Dépenses" in content
    assert "Total de la période" in content
    assert "25 000 FCFA" in content
    assert "Électricité" in content
    assert "bénéfice" not in content.lower()
