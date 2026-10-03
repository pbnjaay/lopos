"""Phase 9 : recette sécurité — ce que les suites d'isolation ne couvraient pas.

- l'API est en ajout seul : aucun PUT, PATCH ni DELETE, sur aucune route ;
- dans un même commerce, un gérant d'un magasin ne voit rien d'un autre ;
- un identifiant mal formé ne provoque jamais d'erreur serveur ;
- un client d'un autre commerce au même téléphone ne gêne ni ne fuit.
"""

import re
from io import StringIO
from uuid import uuid4

import pytest
from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import Client
from django.urls import URLPattern, URLResolver, get_resolver, reverse
from rest_framework import status
from rest_framework.test import APIClient

from apps.customers.models import Customer
from apps.inventory.models import InventoryMovement
from apps.sales.models import Sale
from apps.stores.models import StoreAssignment
from apps.tenancy.integrity import find_violations
from apps.tenancy.models import OrganizationMembership
from apps.tenancy.roles import sync_member_access

from .tenancy_factories import Branch, Commerce, build_branch, build_commerce

pytestmark = [pytest.mark.django_db, pytest.mark.explicit_tenancy]
User = get_user_model()


@pytest.fixture(autouse=True)
def no_cross_commerce_data_left_behind():
    yield
    assert [rule.label for rule, _ in find_violations()] == []


@pytest.fixture
def a() -> Commerce:
    return build_commerce("a")


@pytest.fixture
def b() -> Commerce:
    return build_commerce("b")


@pytest.fixture
def a2(a: Commerce) -> Branch:
    return build_branch(a, "a2")


@pytest.fixture
def manager_a1(a: Commerce) -> User:
    """Gérant du seul magasin d'origine de A, avec les droits de son rôle."""
    call_command("create_default_groups", stdout=StringIO())
    manager = User.objects.create_user(username="gerant-a1")
    OrganizationMembership.objects.create(
        organization=a.organization,
        user=manager,
        role=OrganizationMembership.Role.MANAGER,
        can_view_costs=True,
    )
    StoreAssignment.objects.create(user=manager, store=a.store)
    sync_member_access(manager)
    return User.objects.get(pk=manager.pk)


def _api(user) -> APIClient:
    client = APIClient()
    client.force_authenticate(user)
    return client


def _admin(user) -> Client:
    client = Client()
    client.force_login(user)
    return client


UUID_RE = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")


def _same_as_unknown(response, unknown) -> None:
    """Même statut et même corps qu'un identifiant inexistant, à l'identifiant
    près (que certains messages reprennent)."""
    assert response.status_code == unknown.status_code
    assert UUID_RE.sub("<id>", response.content.decode()) == UUID_RE.sub(
        "<id>", unknown.content.decode()
    )


# --- L'API est en ajout seul ------------------------------------------------


def _api_routes():
    def walk(patterns, prefix=""):
        for pattern in patterns:
            route = prefix + str(pattern.pattern)
            if isinstance(pattern, URLResolver):
                yield from walk(pattern.url_patterns, route)
            elif isinstance(pattern, URLPattern) and route.startswith("api/"):
                yield route, pattern

    return list(walk(get_resolver().url_patterns))


def test_no_api_route_updates_or_deletes_anything() -> None:
    """Rien ne se modifie ni ne se supprime par l'API : une vente s'annule,
    une dépense s'annule, un retour se crée — toujours une nouvelle écriture."""
    for route, pattern in _api_routes():
        view = pattern.callback
        actions = getattr(view, "actions", None)
        methods = set(actions) if actions else {
            method for method in ("put", "patch", "delete") if hasattr(view.cls, method)
        }
        assert not methods & {"put", "patch", "delete"}, route


@pytest.mark.parametrize("method", ["put", "patch", "delete"])
@pytest.mark.parametrize(
    ("route", "attribute"),
    [
        ("store-detail", "store"),
        ("product-detail", "product"),
        ("customer-detail", "customer"),
        ("expense-detail", "expense"),
        ("sale-detail", "sale"),
    ],
)
def test_writing_verbs_on_another_commerce_record_reveal_nothing(a, b, method, route, attribute) -> None:
    client = _api(a.owner)

    response = getattr(client, method)(reverse(route, kwargs={"pk": getattr(b, attribute).pk}), {})
    unknown = getattr(client, method)(reverse(route, kwargs={"pk": uuid4()}), {})

    assert response.status_code == status.HTTP_405_METHOD_NOT_ALLOWED
    assert response.json() == unknown.json()


# --- Deux magasins d'un même commerce --------------------------------------


@pytest.mark.parametrize(
    ("route", "attribute"),
    [
        ("store-detail", "store"),
        ("cash-register-detail", "register"),
        ("cash-session-summary", "session"),
        ("customer-detail", "customer"),
        ("expense-detail", "expense"),
    ],
)
def test_store_manager_cannot_read_another_store_of_the_commerce(
    a, a2, manager_a1, route, attribute
) -> None:
    client = _api(manager_a1)

    response = client.get(reverse(route, kwargs={"pk": getattr(a2, attribute).pk}))
    unknown = client.get(reverse(route, kwargs={"pk": uuid4()}))

    _same_as_unknown(response, unknown)
    assert response.status_code == status.HTTP_404_NOT_FOUND


def test_owner_reaches_every_store_of_the_commerce(a, a2) -> None:
    client = _api(a.owner)

    assert client.get(reverse("customer-detail", kwargs={"pk": a2.customer.pk})).status_code == 200
    assert client.get(reverse("expense-detail", kwargs={"pk": a2.expense.pk})).status_code == 200


@pytest.mark.parametrize("route", ["product-list", "product-top", "customer-list"])
def test_store_manager_cannot_query_another_store_of_the_commerce(a, a2, manager_a1, route) -> None:
    client = _api(manager_a1)

    response = client.get(reverse(route), {"store_id": str(a2.store.pk)})
    unknown = client.get(reverse(route), {"store_id": str(uuid4())})

    assert response.status_code in (400, 404)
    _same_as_unknown(response, unknown)


def test_store_manager_cannot_act_on_another_store_of_the_commerce(a, a2, manager_a1) -> None:
    client = _api(manager_a1)
    movements_before = InventoryMovement.objects.count()

    cancel = client.post(reverse("sale-cancel", kwargs={"pk": a2.sale.pk}), {"reason": "Erreur de saisie"}, format="json")
    stock_in = client.post(
        reverse("inventory-stock-in"),
        {"store_id": str(a2.store.pk), "product_id": str(a.product.pk), "quantity": "5"},
        format="json",
    )
    expense_cancel = client.post(
        reverse("expense-cancel", kwargs={"pk": a2.expense.pk}), {"reason": "Erreur"}
    )

    assert cancel.status_code == status.HTTP_404_NOT_FOUND
    assert stock_in.status_code == status.HTTP_400_BAD_REQUEST
    assert expense_cancel.status_code == status.HTTP_404_NOT_FOUND
    a2.sale.refresh_from_db()
    assert a2.sale.status == Sale.Status.COMPLETED
    assert InventoryMovement.objects.count() == movements_before


def test_store_manager_back_office_shows_its_store_only(a, a2, manager_a1) -> None:
    client = _admin(manager_a1)

    sales = set(client.get(reverse("admin:sales_sale_changelist")).context["cl"].queryset)
    customers = set(client.get(reverse("admin:customers_customer_changelist")).context["cl"].queryset)
    dashboard = client.get(reverse("admin:index")).context["dashboard"]
    opened = client.get(reverse("admin:sales_sale_change", args=[a2.sale.pk]))

    assert sales == {a.sale}
    assert customers == {a.customer}
    assert {sale.pk for sale in dashboard.recent_sales} == {a.sale.pk}
    assert opened.status_code == 302


# --- Robustesse -------------------------------------------------------------


@pytest.mark.parametrize(
    "url",
    [
        "/api/v1/stores/pas-un-uuid/",
        "/api/v1/cash-registers/pas-un-uuid/",
        "/api/v1/cash-registers/?store_id=pas-un-uuid",
        "/api/v1/products/pas-un-uuid/",
        "/api/v1/products/?store_id=pas-un-uuid",
        "/api/v1/products/top/?store_id=pas-un-uuid",
        "/api/v1/customers/?store_id=pas-un-uuid",
        "/api/v1/sales/?cash_session_id=pas-un-uuid",
        "/api/v1/expenses/?category_id=pas-un-uuid",
        "/api/v1/sync/pull/?cursor=pas-une-date",
    ],
)
def test_malformed_identifiers_never_cause_a_server_error(a, url) -> None:
    response = _api(a.owner).get(url)

    assert response.status_code in (400, 404), response.status_code


def test_admin_history_of_another_commerce_record_is_not_found(a, b) -> None:
    call_command("create_default_groups", stdout=StringIO())
    sync_member_access(a.owner)
    client = _admin(User.objects.get(pk=a.owner.pk))

    response = client.get(reverse("admin:sales_sale_history", args=[b.sale.pk]))

    assert response.status_code == 302


# --- Téléphone d'un client ----------------------------------------------------


def test_same_phone_in_another_commerce_neither_blocks_nor_leaks(a, b) -> None:
    Customer.objects.filter(pk=b.customer.pk).update(phone="+221770000001")

    response = _api(a.owner).post(
        reverse("customer-list"),
        {"store_id": str(a.store.pk), "name": "Awa", "phone": "770000001"},
        format="json",
    )

    assert response.status_code == status.HTTP_201_CREATED
    assert response.json()["id"] != str(b.customer.pk)
    assert response.json()["name"] == "Awa"
