"""Parcours complet du gérant sur les données de démo, de la réception au
résultat estimé — la vérification pilote de la feature, chiffres calculés à
la main.

Démo : Coca 50cl 40 unités au coût 350, vendu 500 ; Eau 60 × 280 (400),
Pain 30 × 120 (150), Riz 25 × 750 (900), Lait 15 × 1 800 (2 200).
"""

from decimal import Decimal
from io import StringIO
from uuid import uuid4

import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.management import call_command
from django.test import override_settings
from django.urls import reverse

from apps.cash.models import CashSession
from apps.catalog.models import Product
from apps.expenses.models import ExpenseCategory
from apps.expenses.services import create_expense
from apps.inventory.models import Stock, StockCostChange
from apps.sales.models import Payment
from apps.sales.services import complete_sale, create_sale_return


pytestmark = pytest.mark.django_db
User = get_user_model()


@pytest.fixture
def demo():
    with override_settings(DEBUG=True):
        call_command("seed_demo", "--open-session", stdout=StringIO())
    call_command("create_default_groups", stdout=StringIO())
    return CashSession.objects.get(status=CashSession.Status.OPEN)


@pytest.fixture
def manager_client(client):
    manager = User.objects.create_user(username="gerant", password="pass1234", is_staff=True)
    manager.groups.add(Group.objects.get(name="Gérant"))
    client.force_login(manager)
    return client


def test_manager_follows_stock_value_and_daily_result(demo: CashSession, manager_client) -> None:
    session = demo
    coca = Product.objects.get(name="Coca 50cl")
    store = session.cash_register.store

    # 1. Réception de 60 Coca à 400 : (40 × 350 + 60 × 400) / 100 = 380.
    manager_client.post(
        reverse("admin:catalog_product_receive_stock", args=[coca.pk]),
        {"store": str(store.pk), "quantity": "60", "unit_cost": "400"},
    )
    assert Stock.objects.get(store=store, product=coca).average_unit_cost == Decimal("380.0000")

    # 2. Vente de 10 Coca : CA 5 000, coût 3 800.
    sale = complete_sale(
        cash_session=session,
        items=[{"product_id": coca.id, "quantity": Decimal("10"), "unit_price": None}],
        payments=[
            {
                "method": Payment.Method.CASH,
                "amount": Decimal("5000"),
                "received_amount": Decimal("5000"),
            }
        ],
    )
    assert sale.items.get().unit_cost == Decimal("380.0000")

    # 3. Retour d'une Coca remise en stock : CA − 500, coût − 380.
    create_sale_return(
        original_sale=sale,
        cash_session=session,
        created_by=session.cashier,
        payment_method=Payment.Method.CASH,
        idempotency_key=uuid4(),
        items=[{"sale_item_id": sale.items.get().id, "quantity": Decimal("1"), "restock": True}],
    )

    # 4. Dépense de 500 payée par Wave.
    create_expense(
        cash_session=session,
        created_by=session.cashier,
        category=ExpenseCategory.objects.get(name="Autre"),
        amount=Decimal("500"),
        payment_method=Payment.Method.WAVE,
        description="Sacs plastiques",
        idempotency_key=uuid4(),
    )

    # Tableau de bord : CA 4 500 · coût 3 420 · marge 1 080 · dépenses 500 · résultat 580.
    dashboard = manager_client.get(reverse("admin:index"))
    profitability = dashboard.context["dashboard"].profitability
    assert profitability.revenue == Decimal("4500.00")
    assert profitability.cost_of_goods_sold == Decimal("3420.00")
    assert profitability.gross_margin == Decimal("1080.00")
    assert profitability.expenses == Decimal("500.00")
    assert profitability.estimated_result == Decimal("580.00")
    assert profitability.is_complete
    content = dashboard.content.decode()
    assert "Résultat estimé" in content
    assert "580 FCFA" in content
    assert "Résultat incomplet" not in content

    # Valorisation : Coca 91 × 380 = 34 580 ; total d'achat 100 730, de vente 129 500.
    valuation_page = manager_client.get(reverse("admin:inventory_stockvaluation_changelist"))
    valuation = valuation_page.context["valuation"]
    assert valuation.cost_value == Decimal("100730.00")
    assert valuation.sale_value == Decimal("129500.00")
    assert valuation.potential_margin == Decimal("28770.00")
    assert valuation.coverage_percent == 100
    assert "100 730 FCFA" in valuation_page.content.decode()

    # Correction tracée d'un coût, visible dans le journal.
    bread = Stock.objects.get(store=store, product__name="Pain")
    manager_client.post(
        reverse("admin:inventory_stockvaluation_set_cost_action", args=[bread.pk]),
        {"unit_cost": "110", "reason": "Nouveau tarif boulangerie"},
    )
    change = StockCostChange.objects.get(source=StockCostChange.Source.CORRECTION)
    assert (change.previous_cost, change.new_cost) == (Decimal("120.0000"), Decimal("110.0000"))
    journal = manager_client.get(reverse("admin:inventory_stockcostchange_changelist"))
    assert "Nouveau tarif boulangerie" in journal.content.decode()

    # La marge du jour ne bouge pas : les ventes gardent leur coût figé.
    after = manager_client.get(reverse("admin:index")).context["dashboard"].profitability
    assert after.gross_margin == Decimal("1080.00")
