from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.management import call_command
from django.urls import reverse

from apps.catalog.models import Product
from apps.inventory.exceptions import InvalidStockCost
from apps.inventory.models import InventoryMovement, Stock, StockCostChange
from apps.inventory.services import set_stock_unit_cost
from apps.stores.models import Store


pytestmark = pytest.mark.django_db
User = get_user_model()

VALUATION_URL = "admin:inventory_stockvaluation_changelist"


@pytest.fixture
def store() -> Store:
    return Store.objects.create(name="Supérette Louga")


@pytest.fixture
def manager(client):
    call_command("create_default_groups", stdout=None)
    user = User.objects.create_user(username="gerant", password="pass1234", is_staff=True)
    user.groups.add(Group.objects.get(name="Gérant"))
    return user


@pytest.fixture
def manager_client(client, manager):
    client.login(username="gerant", password="pass1234")
    return client


def _stock(store: Store, name: str, quantity, selling_price, cost) -> Stock:
    product = Product.objects.create(name=name, selling_price=Decimal(selling_price))
    return Stock.objects.create(
        store=store,
        product=product,
        quantity=Decimal(quantity),
        average_unit_cost=None if cost is None else Decimal(cost),
    )


def _set_cost_url(stock: Stock) -> str:
    return reverse("admin:inventory_stockvaluation_set_cost_action", args=[stock.pk])


# --- Service : définir un coût ------------------------------------------------


def test_setting_an_unknown_cost_is_an_initialization(store: Store, manager) -> None:
    stock = _stock(store, "Savon", "20", "250", None)

    change = set_stock_unit_cost(stock_id=stock.pk, unit_cost=Decimal("180"), created_by=manager)

    stock.refresh_from_db()
    assert stock.average_unit_cost == Decimal("180.0000")
    assert change.source == StockCostChange.Source.INITIAL
    assert change.previous_cost is None
    assert change.quantity_at_change == Decimal("20.000")
    assert change.created_by == manager
    # Aucun faux mouvement : la quantité n'a pas bougé.
    assert not InventoryMovement.objects.exists()


def test_correcting_a_known_cost_requires_a_reason(store: Store, manager) -> None:
    stock = _stock(store, "Coca 50cl", "10", "500", "300")

    with pytest.raises(InvalidStockCost):
        set_stock_unit_cost(stock_id=stock.pk, unit_cost=Decimal("320"), created_by=manager)

    stock.refresh_from_db()
    assert stock.average_unit_cost == Decimal("300.0000")
    assert not StockCostChange.objects.exists()


def test_correction_is_traced_with_both_costs(store: Store, manager) -> None:
    stock = _stock(store, "Coca 50cl", "10", "500", "300")

    change = set_stock_unit_cost(
        stock_id=stock.pk,
        unit_cost=Decimal("320"),
        reason="Facture fournisseur retrouvée",
        created_by=manager,
    )

    assert change.source == StockCostChange.Source.CORRECTION
    assert change.previous_cost == Decimal("300.0000")
    assert change.new_cost == Decimal("320.0000")
    assert change.reason == "Facture fournisseur retrouvée"


def test_setting_the_same_cost_writes_nothing(store: Store, manager) -> None:
    stock = _stock(store, "Coca 50cl", "10", "500", "300")

    assert set_stock_unit_cost(stock_id=stock.pk, unit_cost=Decimal("300"), created_by=manager) is None
    assert not StockCostChange.objects.exists()


@pytest.mark.parametrize("unit_cost", [Decimal("0"), Decimal("-5")])
def test_a_manual_cost_must_be_positive(store: Store, manager, unit_cost: Decimal) -> None:
    stock = _stock(store, "Savon", "20", "250", None)

    with pytest.raises(InvalidStockCost):
        set_stock_unit_cost(stock_id=stock.pk, unit_cost=unit_cost, created_by=manager)

    stock.refresh_from_db()
    assert stock.average_unit_cost is None


# --- Page Valorisation ----------------------------------------------------------


def test_valuation_page_shows_the_three_indicators_for_all_stores(
    manager_client, store: Store
) -> None:
    _stock(store, "Coca 50cl", "10", "500", "300")

    response = manager_client.get(reverse(VALUATION_URL))

    assert response.status_code == 200
    content = response.content.decode()
    assert "Tous les magasins" in content
    assert "Valeur d'achat du stock" in content
    assert "3 000 FCFA" in content
    assert "5 000 FCFA" in content
    assert "2 000 FCFA" in content
    # Vocabulaire du gérant, jamais celui du comptable.
    assert "Bénéfice" not in content
    assert "WAC" not in content


def test_valuation_indicators_follow_the_store_filter(manager_client, store: Store) -> None:
    other_store = Store.objects.create(name="Boutique Médina")
    _stock(store, "Coca 50cl", "10", "500", "300")
    _stock(other_store, "Fanta", "4", "500", "350")

    response = manager_client.get(
        reverse(VALUATION_URL), {"store__id__exact": str(other_store.pk)}
    )

    content = response.content.decode()
    assert response.context["valuation_scope"] == "Boutique Médina"
    assert response.context["valuation"].cost_value == Decimal("1400.00")
    assert "Coca 50cl" not in content


def test_valuation_flags_unknown_costs_and_negative_stock(manager_client, store: Store) -> None:
    _stock(store, "Coca 50cl", "10", "500", "300")
    _stock(store, "Savon", "20", "250", None)
    _stock(store, "Fanta", "-2", "500", "300")

    response = manager_client.get(reverse(VALUATION_URL))

    content = response.content.decode()
    assert "1 produit en stock sans coût d'achat" in content
    assert "couverture 50 %" in content
    assert "1 produit en stock négatif" in content
    assert "valuation=uncosted" in content
    assert "valuation=negative" in content


def test_unknown_cost_filter_lists_only_unvalued_products(manager_client, store: Store) -> None:
    _stock(store, "Coca 50cl", "10", "500", "300")
    _stock(store, "Savon", "20", "250", None)

    response = manager_client.get(reverse(VALUATION_URL), {"valuation": "uncosted"})

    rows = list(response.context["cl"].result_list)
    assert [row.product.name for row in rows] == ["Savon"]
    assert response.context["valuation"].uncosted_count == 1
    assert response.context["valuation"].cost_value == Decimal("0.00")


def test_biggest_values_come_first_and_unknown_costs_last(manager_client, store: Store) -> None:
    _stock(store, "Savon", "20", "250", None)
    _stock(store, "Coca 50cl", "10", "500", "300")
    _stock(store, "Riz 25kg", "4", "5000", "4000")

    response = manager_client.get(reverse(VALUATION_URL))

    names = [row.product.name for row in response.context["cl"].result_list]
    assert names == ["Riz 25kg", "Coca 50cl", "Savon"]


def test_valuation_page_does_not_query_per_row(
    manager_client, store: Store, django_assert_max_num_queries
) -> None:
    for index in range(30):
        _stock(store, f"Produit {index:02}", "10", "500", "300")

    with django_assert_max_num_queries(25):
        response = manager_client.get(reverse(VALUATION_URL))

    assert response.status_code == 200


def test_staff_without_permission_cannot_see_costs(client, store: Store) -> None:
    User.objects.create_user(username="caissier", password="pass1234", is_staff=True)
    client.login(username="caissier", password="pass1234")
    stock = _stock(store, "Coca 50cl", "10", "500", "300")

    assert client.get(reverse(VALUATION_URL)).status_code == 403
    assert client.get(_set_cost_url(stock)).status_code == 403
    assert client.get(reverse("admin:inventory_stockcostchange_changelist")).status_code == 403


# --- Action « Définir le coût » -----------------------------------------------------


def test_set_cost_page_is_prefilled_with_the_last_purchase_price(
    manager_client, store: Store
) -> None:
    stock = _stock(store, "Savon", "20", "250", None)
    Product.objects.filter(pk=stock.product_id).update(purchase_price=Decimal("180"))

    response = manager_client.get(_set_cost_url(stock))

    assert response.status_code == 200
    content = response.content.decode()
    assert 'value="180.00"' in content
    assert "pas encore de coût d'achat" in content


def test_manager_initializes_a_cost_from_the_valuation_page(
    manager_client, manager, store: Store
) -> None:
    stock = _stock(store, "Savon", "20", "250", None)

    response = manager_client.post(_set_cost_url(stock), {"unit_cost": "180", "reason": ""}, follow=True)

    assert response.status_code == 200
    stock.refresh_from_db()
    assert stock.average_unit_cost == Decimal("180.0000")
    change = StockCostChange.objects.get()
    assert change.source == StockCostChange.Source.INITIAL
    assert change.created_by == manager
    assert "Coût de Savon (Supérette Louga) : — → 180 FCFA." in response.content.decode()


def test_correction_without_reason_is_refused_on_the_form(manager_client, store: Store) -> None:
    stock = _stock(store, "Coca 50cl", "10", "500", "300")

    response = manager_client.post(_set_cost_url(stock), {"unit_cost": "320", "reason": ""})

    assert response.status_code == 200
    assert "Indiquez le motif" in response.content.decode()
    stock.refresh_from_db()
    assert stock.average_unit_cost == Decimal("300.0000")


def test_correction_with_reason_is_saved_and_logged(manager_client, store: Store) -> None:
    stock = _stock(store, "Coca 50cl", "10", "500", "300")

    manager_client.post(_set_cost_url(stock), {"unit_cost": "320", "reason": "Erreur de saisie"})

    stock.refresh_from_db()
    assert stock.average_unit_cost == Decimal("320.0000")
    response = manager_client.get(reverse("admin:inventory_stockcostchange_changelist"))
    content = response.content.decode()
    assert "Erreur de saisie" in content
    assert "300 FCFA" in content
    assert "320 FCFA" in content


def test_zero_cost_is_refused_on_the_form(manager_client, store: Store) -> None:
    stock = _stock(store, "Savon", "20", "250", None)

    response = manager_client.post(_set_cost_url(stock), {"unit_cost": "0", "reason": ""})

    assert response.status_code == 200
    assert "supérieur à 0" in response.content.decode()
    stock.refresh_from_db()
    assert stock.average_unit_cost is None


# --- Mouvements de stock ---------------------------------------------------------


def test_movements_list_shows_the_unit_cost_and_author(
    manager_client, manager, store: Store
) -> None:
    from apps.inventory.services import receive_stock

    product = Product.objects.create(name="Coca 50cl", selling_price=Decimal("500"))
    receive_stock(store=store, product=product, quantity=10, unit_cost=Decimal("350"), created_by=manager)

    response = manager_client.get(reverse("admin:inventory_inventorymovement_changelist"))

    content = response.content.decode()
    assert "350 FCFA" in content
    assert "gerant" in content


def test_manager_sees_the_set_cost_action_on_each_row(manager_client, store: Store) -> None:
    stock = _stock(store, "Savon", "20", "250", None)

    response = manager_client.get(reverse(VALUATION_URL))

    assert _set_cost_url(stock) in response.content.decode()


def test_view_only_user_sees_values_but_cannot_set_costs(client, store: Store) -> None:
    from django.contrib.auth.models import Permission

    viewer = User.objects.create_user(username="lecteur", password="pass1234", is_staff=True)
    viewer.user_permissions.add(Permission.objects.get(codename="view_stockvaluation"))
    client.login(username="lecteur", password="pass1234")
    stock = _stock(store, "Savon", "20", "250", None)

    response = client.get(reverse(VALUATION_URL))

    assert response.status_code == 200
    assert _set_cost_url(stock) not in response.content.decode()
    assert client.post(_set_cost_url(stock), {"unit_cost": "180"}).status_code == 403
    stock.refresh_from_db()
    assert stock.average_unit_cost is None


# --- Export CSV ------------------------------------------------------------------

EXPORT_URL = "admin:inventory_stockvaluation_export"


def _csv_rows(response) -> list[list[str]]:
    import csv
    import io

    text = response.content.decode("utf-8")
    assert text.startswith("﻿")
    return list(csv.reader(io.StringIO(text.lstrip("﻿")), delimiter=";"))


def test_csv_export_lists_every_stock_with_french_numbers(manager_client, store: Store) -> None:
    _stock(store, "Coca 50cl", "24", "500", "350")
    _stock(store, "Riz", "2.5", "600", "333.3333")
    _stock(store, "Savon", "20", "250", None)

    response = manager_client.get(reverse(EXPORT_URL))

    assert response.status_code == 200
    assert response["Content-Type"] == "text/csv; charset=utf-8"
    assert "valorisation-stock-" in response["Content-Disposition"]
    header, *rows = _csv_rows(response)
    assert header[0] == "Produit"
    assert header[-1] == "Marge potentielle"
    by_name = {row[0]: row for row in rows}
    assert by_name["Coca 50cl"][3:] == ["24", "350", "8400", "500", "12000", "3600"]
    assert by_name["Riz"][3:] == ["2,5", "333,33", "833,33", "600", "1500", "666,67"]
    # Coût inconnu : cases vides, jamais 0.
    assert by_name["Savon"][3:] == ["20", "", "", "250", "5000", ""]


def test_csv_export_follows_the_page_filters(manager_client, store: Store) -> None:
    other_store = Store.objects.create(name="Boutique Médina")
    _stock(store, "Coca 50cl", "24", "500", "350")
    _stock(store, "Savon", "20", "250", None)
    _stock(other_store, "Fanta", "4", "500", "350")

    response = manager_client.get(
        reverse(EXPORT_URL), {"store__id__exact": str(store.pk), "valuation": "uncosted"}
    )

    _header, *rows = _csv_rows(response)
    assert [row[0] for row in rows] == ["Savon"]


def test_valuation_page_links_to_the_filtered_export(manager_client, store: Store) -> None:
    _stock(store, "Coca 50cl", "24", "500", "350")

    response = manager_client.get(reverse(VALUATION_URL), {"valuation": "in_stock"})

    assert f"{reverse(EXPORT_URL)}?valuation=in_stock" in response.content.decode()


def test_csv_export_requires_valuation_access(client, store: Store) -> None:
    User.objects.create_user(username="staff", password="pass1234", is_staff=True)
    client.login(username="staff", password="pass1234")
    _stock(store, "Coca 50cl", "24", "500", "350")

    assert client.get(reverse(EXPORT_URL)).status_code == 403


def test_set_cost_form_uses_the_admin_styled_inputs(manager_client, store: Store) -> None:
    stock = _stock(store, "Savon", "20", "250", None)

    content = manager_client.get(_set_cost_url(stock)).content.decode()

    # Widgets Unfold (bordure, fond) et non des champs HTML nus, peu visibles.
    assert '<input type="number" name="unit_cost" class="border border-base-200' in content
    assert '<textarea name="reason" cols="40" rows="2" class="vLargeTextField border' in content
