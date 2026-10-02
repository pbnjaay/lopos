"""L'admin parle comme le POS : « Ticket E15F6488 », pas un UUID."""

from datetime import datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

import pytest
from django.contrib.auth import get_user_model
from django.urls import reverse

from apps.cash.models import CashSession
from apps.catalog.models import Product
from apps.inventory.models import InventoryMovement
from apps.inventory.services import receive_stock
from apps.sales.models import Payment, Sale
from apps.sales.services import complete_sale
from apps.stores.models import CashRegister, Store


pytestmark = pytest.mark.django_db
User = get_user_model()


@pytest.fixture
def admin_client(client):
    client.force_login(User.objects.create_superuser(username="admin", password="x"))
    return client


@pytest.fixture
def session() -> CashSession:
    store = Store.objects.create(name="Supérette Louga")
    register = CashRegister.objects.create(store=store, name="Caisse 01")
    return CashSession.objects.create(
        cash_register=register,
        cashier=User.objects.create_user(username="caissier"),
        opening_balance=Decimal("10000"),
    )


@pytest.fixture
def sale(session: CashSession) -> Sale:
    store = session.cash_register.store
    coca = Product.objects.create(name="Coca 50cl", selling_price=Decimal("500"))
    banana = Product.objects.create(
        name="Banane", selling_price=Decimal("1200"), sale_unit=Product.SaleUnit.KG
    )
    receive_stock(store=store, product=coca, quantity=10, unit_cost=Decimal("350"))
    receive_stock(store=store, product=banana, quantity=5, unit_cost=Decimal("800"))
    return complete_sale(
        cash_session=session,
        items=[
            {"product_id": coca.id, "quantity": Decimal("2"), "unit_price": None},
            {"product_id": banana.id, "quantity": Decimal("0.5"), "unit_price": None},
        ],
        payments=[
            {
                "method": Payment.Method.CASH,
                "amount": Decimal("1600"),
                "received_amount": Decimal("2000"),
            }
        ],
    )


# --- Noms lisibles -----------------------------------------------------------------


def test_a_sale_is_named_after_its_printed_ticket(sale: Sale) -> None:
    assert sale.reference == str(sale.id)[:8].upper()
    assert str(sale) == f"Ticket {sale.reference}"


def test_sale_lines_and_payments_read_naturally(sale: Sale) -> None:
    names = sorted(str(item) for item in sale.items.all())

    assert names == ["Banane × 0,5 kg", "Coca 50cl × 2"]
    assert str(sale.payments.get()) == "Espèces — 1 600 FCFA"


def test_cash_session_is_named_with_its_local_opening_time(session: CashSession) -> None:
    # 22:30 UTC = 22:30 à Dakar (UTC+0) : la date suit le fuseau du projet.
    session.opened_at = datetime(2026, 9, 29, 22, 30, tzinfo=ZoneInfo("UTC"))

    assert str(session) == "Supérette Louga — Caisse 01 — 29/09/2026 22:30"


# --- Ventes dans l'admin ---------------------------------------------------------------


def test_sales_list_shows_the_ticket_number_not_the_uuid(admin_client, sale: Sale) -> None:
    content = admin_client.get(reverse("admin:sales_sale_changelist")).content.decode()

    assert sale.reference in content
    assert f">{sale.id}<" not in content


@pytest.mark.parametrize("term", ["{ref}", "{ref_lower}", "Ticket {ref}", "ticket {ref_lower}"])
def test_a_sale_is_found_by_its_printed_ticket_number(
    admin_client, sale: Sale, session: CashSession, term: str
) -> None:
    other = complete_sale(
        cash_session=session,
        items=[{"product_id": sale.items.first().product_id, "quantity": Decimal("1"), "unit_price": None}],
        payments=[{"method": Payment.Method.WAVE, "amount": sale.items.first().unit_price}],
    )
    query = term.format(ref=sale.reference, ref_lower=sale.reference.lower())

    response = admin_client.get(reverse("admin:sales_sale_changelist"), {"q": query})

    found = [row.pk for row in response.context["cl"].result_list]
    assert found == [sale.pk]
    assert other.pk not in found


def test_sale_page_hides_technical_details(admin_client, sale: Sale) -> None:
    content = admin_client.get(reverse("admin:sales_sale_change", args=[sale.pk])).content.decode()

    assert f"Ticket {sale.reference}" in content
    # Plus de titre technique au-dessus de chaque ligne d'articles ou de paiement.
    assert "Coca 50cl × 2" not in content
    assert "Espèces — 1 600 FCFA" not in content
    assert "created_at" not in content
    assert "sum(paiements)" not in content


# --- Mouvements de stock -----------------------------------------------------------------


def test_movements_link_to_their_ticket(admin_client, sale: Sale) -> None:
    movement = InventoryMovement.objects.filter(
        movement_type=InventoryMovement.Type.SALE
    ).first()

    content = admin_client.get(
        reverse("admin:inventory_inventorymovement_changelist")
    ).content.decode()

    assert f"Ticket {sale.reference}" in content
    assert reverse("admin:sales_sale_change", args=[movement.reference]) in content
