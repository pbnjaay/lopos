"""Phase 4 : le back-office Unfold d'un commerce ne montre que ce commerce.

Listes, fiches, actions, autocomplétions, listes déroulantes, filtres,
vues sur mesure et tableau de bord, face à un second commerce complet.
"""

from decimal import Decimal
from io import BytesIO

import pytest
from django.contrib import admin
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.test import Client
from django.urls import reverse

from apps.catalog.models import Product
from apps.expenses.models import Expense, ExpenseCategory
from apps.inventory.models import InventoryMovement, Stock
from apps.stores.models import CashRegister, Store, StoreAssignment
from apps.tenancy.admin_mixins import TenantAdminMixin, TenantRelatedFieldListFilter
from apps.tenancy.context import resolve_tenant
from apps.tenancy.integrity import find_violations
from apps.tenancy.models import Organization, OrganizationMembership
from apps.tenancy.roles import sync_member_access
from apps.tenancy.scoping import scope

from .tenancy_factories import Commerce, build_commerce

pytestmark = [pytest.mark.django_db, pytest.mark.explicit_tenancy]


@pytest.fixture(autouse=True)
def no_cross_commerce_data_left_behind():
    """Après chaque attaque, refusée ou non, rien ne relie deux commerces."""
    yield
    assert [rule.label for rule, _ in find_violations()] == []
User = get_user_model()

# Réservés à la plateforme (ou à son propre compte) : pas de données de
# commerce à filtrer.
PLATFORM_ADMINS = {Group, Organization}


@pytest.fixture
def a() -> Commerce:
    return build_commerce("a")


@pytest.fixture
def b() -> Commerce:
    return build_commerce("b")


@pytest.fixture
def owner_a(a: Commerce) -> Client:
    """Le propriétaire de A, avec les droits d'administration du gérant."""
    call_command("create_default_groups")
    a.owner.groups.add(Group.objects.get(name="Gérant"))
    client = Client()
    client.force_login(a.owner)
    return client


def _changelist(model) -> str:
    return reverse(f"admin:{model._meta.app_label}_{model._meta.model_name}_changelist")


def _change(obj) -> str:
    return reverse(
        f"admin:{obj._meta.app_label}_{obj._meta.model_name}_change", args=[obj.pk]
    )


# --- Garde-fou structurel --------------------------------------------------


def test_every_business_admin_and_inline_is_tenant_scoped() -> None:
    for model, model_admin in admin.site._registry.items():
        if model in PLATFORM_ADMINS:
            continue
        assert isinstance(model_admin, TenantAdminMixin), model.__name__
        for inline in model_admin.inlines:
            if model is Organization:
                continue
            assert issubclass(inline, TenantAdminMixin), f"{model.__name__}.{inline.__name__}"


# --- Listes ------------------------------------------------------------------


def test_no_changelist_shows_the_other_commerce(a, b, owner_a) -> None:
    tenant = resolve_tenant(a.owner)
    checked = 0
    for model, model_admin in admin.site._registry.items():
        if model in PLATFORM_ADMINS or model is User:
            continue
        response = owner_a.get(_changelist(model))
        if response.status_code == 403:  # pas de droit de lecture sur ce modèle
            continue
        assert response.status_code == 200, model.__name__
        listed = set(response.context["cl"].queryset.values_list("pk", flat=True))
        allowed = set(scope(model.objects, tenant).values_list("pk", flat=True))
        assert listed <= allowed, model.__name__
        checked += 1
    assert checked >= 15


def test_platform_superuser_sees_every_commerce(a, b) -> None:
    client = Client()
    client.force_login(User.objects.create_superuser(username="plateforme"))

    response = client.get(_changelist(Store))

    assert set(response.context["cl"].queryset) == {a.store, b.store}


def test_users_list_shows_own_members_only(a, b, owner_a) -> None:
    User.objects.create_superuser(username="plateforme")

    response = owner_a.get(_changelist(User))

    assert set(response.context["cl"].queryset) == {a.owner, a.cashier}


# --- Fiches et actions -------------------------------------------------------


@pytest.mark.parametrize(
    "attribute", ["store", "register", "session", "product", "customer", "sale", "expense", "category"]
)
def test_another_commerce_record_cannot_be_opened(a, b, owner_a, attribute) -> None:
    response = owner_a.get(_change(getattr(b, attribute)))

    # Introuvable : Django renvoie vers l'accueil de l'admin, comme pour un
    # identifiant qui n'existe pas.
    assert response.status_code == 302
    assert response.url == reverse("admin:index")


def test_another_commerce_member_cannot_be_opened_or_edited(a, b, owner_a) -> None:
    assert owner_a.get(_change(b.cashier)).status_code == 302
    password_url = reverse("admin:auth_user_password_change", args=[b.cashier.pk])
    owner_a.post(password_url, {"password1": "Piratage123!", "password2": "Piratage123!"})

    b.cashier.refresh_from_db()
    assert not b.cashier.check_password("Piratage123!")


def test_stock_actions_cannot_target_another_commerce_product(a, b, owner_a) -> None:
    url = reverse("admin:catalog_product_receive_stock", args=[b.product.pk])

    assert owner_a.get(url).status_code == 404
    assert owner_a.post(url, {"store": a.store.pk, "quantity": "5", "unit_cost": "1"}).status_code == 404


def test_stock_receipt_cannot_choose_another_commerce_store(a, b, owner_a) -> None:
    url = reverse("admin:catalog_product_receive_stock", args=[a.product.pk])
    movements_before = InventoryMovement.objects.count()

    response = owner_a.post(url, {"store": b.store.pk, "quantity": "5", "unit_cost": "1"})

    assert response.status_code == 200
    assert "store" in response.context["form"].errors
    assert list(response.context["form"].fields["store"].queryset) == [a.store]
    assert InventoryMovement.objects.count() == movements_before


def test_cost_cannot_be_set_on_another_commerce_stock(a, b, owner_a) -> None:
    stock_b = Stock.objects.get(store=b.store)
    url = reverse("admin:inventory_stockvaluation_set_cost_action", args=[stock_b.pk])

    assert owner_a.post(url, {"unit_cost": "1", "reason": "x"}).status_code == 404
    stock_b.refresh_from_db()
    assert stock_b.average_unit_cost == Decimal("700")


def test_another_commerce_expense_cannot_be_cancelled(a, b, owner_a) -> None:
    url = reverse("admin:expenses_expense_cancel_expense_action", args=[b.expense.pk])

    owner_a.post(url, {"reason": "Piratage"})

    b.expense.refresh_from_db()
    assert b.expense.status == Expense.Status.POSTED


# --- Listes déroulantes, autocomplétions, filtres ---------------------------


def test_form_dropdowns_offer_own_records_only(a, b, owner_a) -> None:
    register_form = owner_a.get(reverse("admin:stores_cashregister_add")).context["adminform"].form
    assignment_form = owner_a.get(reverse("admin:stores_storeassignment_add")).context[
        "adminform"
    ].form
    product_form = owner_a.get(reverse("admin:catalog_product_add")).context["adminform"].form

    assert list(register_form.fields["store"].queryset) == [a.store]
    assert set(assignment_form.fields["user"].queryset) == {a.owner, a.cashier}
    assert list(product_form.fields["initial_store"].queryset) == [a.store]


@pytest.mark.parametrize(
    ("app_label", "model_name", "field_name", "attribute"),
    [
        ("stores", "cashregister", "store", "store"),
        ("stores", "storeassignment", "user", "cashier"),
        ("customers", "customerledgerentry", "customer", "customer"),
        ("inventory", "stock", "product", "product"),
    ],
)
def test_autocomplete_never_suggests_the_other_commerce(
    a, b, owner_a, app_label, model_name, field_name, attribute
) -> None:
    response = owner_a.get(
        reverse("admin:autocomplete"),
        {"app_label": app_label, "model_name": model_name, "field_name": field_name, "term": ""},
    )

    ids = {result["id"] for result in response.json()["results"]}
    assert str(getattr(a, attribute).pk) in ids
    assert str(getattr(b, attribute).pk) not in ids


def _second_store_and_category(a: Commerce) -> None:
    # Un seul choix possible masque le filtre : A en a deux, pour qu'il
    # s'affiche et que ses choix soient vraiment contrôlés.
    Store.objects.create(name="Magasin a-2", organization=a.organization)
    ExpenseCategory.objects.create(name="Transport a", organization=a.organization)


def test_side_filters_offer_own_stores_and_categories_only(a, b, owner_a) -> None:
    _second_store_and_category(a)
    for model, expected in ((CashRegister, {"store"}), (Expense, {"store", "category"})):
        cl = owner_a.get(_changelist(model)).context["cl"]
        specs = {
            spec.field_path: {str(pk) for pk, _ in spec.lookup_choices}
            for spec in cl.filter_specs
            if isinstance(spec, TenantRelatedFieldListFilter)
        }
        assert expected <= set(specs), model.__name__
        offered = set().union(*specs.values())
        assert str(a.store.pk) in offered
        assert str(b.store.pk) not in offered, model.__name__
        assert str(b.category.pk) not in offered, model.__name__


def test_forged_filter_on_another_commerce_store_reveals_nothing(a, b, owner_a) -> None:
    _second_store_and_category(a)

    response = owner_a.get(_changelist(Expense), {"store__id__exact": b.store.pk})

    # Filtre actif sur un magasin hors périmètre : la liste reste vide,
    # jamais les dépenses de B.
    listed = set(response.context["cl"].queryset)
    assert b.expense not in listed
    assert all(expense.store.organization == a.organization for expense in listed)


# --- Créations -------------------------------------------------------------


def test_store_created_by_a_commerce_belongs_to_it(a, b, owner_a) -> None:
    owner_a.post(
        reverse("admin:stores_store_add"),
        {"name": "Louga Marché", "is_active": "on", "organization": b.organization.pk},
    )

    assert Store.objects.get(name="Louga Marché").organization == a.organization


def test_user_created_by_a_commerce_joins_it_as_cashier(a, owner_a) -> None:
    owner_a.post(
        reverse("admin:auth_user_add"),
        {
            "username": "nouvelle",
            "usable_password": "true",
            "password1": "Passer-1234!",
            "password2": "Passer-1234!",
            "store_assignments-TOTAL_FORMS": "0",
            "store_assignments-INITIAL_FORMS": "0",
            "store_assignments-MIN_NUM_FORMS": "0",
            "store_assignments-MAX_NUM_FORMS": "1000",
        },
    )

    membership = OrganizationMembership.objects.get(user__username="nouvelle")
    assert membership.organization == a.organization
    assert membership.role == OrganizationMembership.Role.CASHIER


def test_barcode_is_unique_per_catalog_only(a, b, owner_a) -> None:
    Product.objects.filter(pk=b.product.pk).update(barcode="6000000000001")
    Product.objects.filter(pk=a.product.pk).update(barcode="6000000000002")
    add_url = reverse("admin:catalog_product_add")
    base = {"name": "Soda", "selling_price": "500", "sale_unit": "UNIT", "is_active": "on"}

    duplicate_here = owner_a.post(add_url, {**base, "barcode": "6000000000002"})
    used_elsewhere = owner_a.post(add_url, {**base, "barcode": "6000000000001"})

    assert duplicate_here.status_code == 200
    assert "barcode" in duplicate_here.context["adminform"].form.errors
    assert used_elsewhere.status_code == 302
    created = Product.objects.get(name="Soda")
    assert (created.organization, created.barcode) == (a.organization, "6000000000001")


def test_category_name_is_unique_per_commerce_only(a, b, owner_a) -> None:
    add_url = reverse("admin:expenses_expensecategory_add")
    base = {"sort_order": "0", "is_active": "on"}

    duplicate_here = owner_a.post(add_url, {**base, "name": a.category.name})
    used_elsewhere = owner_a.post(add_url, {**base, "name": b.category.name})

    assert duplicate_here.status_code == 200
    assert "name" in duplicate_here.context["adminform"].form.errors
    assert used_elsewhere.status_code == 302
    assert ExpenseCategory.objects.filter(name=b.category.name).count() == 2


def test_csv_import_only_sees_own_stores_and_catalog(a, b, owner_a) -> None:
    Product.objects.filter(pk=b.product.pk).update(barcode="6000000000001")
    content = (
        "barcode,name,purchase_price,selling_price,store,initial_stock\n"
        f"6000000000001,Soda,300,500,{b.store.name},10\n"
    ).encode()

    response = owner_a.post(
        reverse("admin:catalog_product_import_products_view"),
        {"csv_file": SimpleUploadedFile("p.csv", BytesIO(content).read(), "text/csv")},
    )

    # Le magasin de B est inconnu ; le code-barres de B, lui, ne gêne pas.
    page = response.content.decode()
    assert f"Magasin introuvable : {b.store.name}" in page
    assert "code-barres existe déjà" not in page
    assert not Product.objects.filter(name="Soda").exists()


# --- Fiche produit et tableau de bord ----------------------------------------


def test_product_card_shows_assigned_stores_only(a, owner_a) -> None:
    other = Store.objects.create(name="Magasin a-2", organization=a.organization)
    Stock.objects.create(store=other, product=a.product, quantity=3)
    manager = User.objects.create_user(username="manager-a", is_staff=True)
    manager.groups.add(Group.objects.get(name="Gérant"))
    OrganizationMembership.objects.create(
        organization=a.organization, user=manager, role=OrganizationMembership.Role.MANAGER
    )
    StoreAssignment.objects.create(user=manager, store=a.store)
    client = Client()
    client.force_login(manager)

    card = client.get(_change(a.product)).context["product_card"]

    assert [stock.store for stock in card.stocks] == [a.store.name]


def test_dashboard_covers_own_stores_only(a, b, owner_a) -> None:
    response = owner_a.get(reverse("admin:index"))
    dashboard = response.context["dashboard"]

    assert response.context["dashboard_stores"] == [a.store]
    # Une vente de 2 000 par commerce : seule celle de A compte.
    assert dashboard.gross_sales == Decimal("2000")
    assert {s.pk for s in dashboard.recent_sales} == {a.sale.pk}


def test_dashboard_ignores_a_forged_store_parameter(a, b, owner_a) -> None:
    response = owner_a.get(reverse("admin:index"), {"store": str(b.store.pk)})
    dashboard = response.context["dashboard"]

    assert dashboard.store_id is None
    assert dashboard.scope_label == "Tous les magasins"
    assert {s.pk for s in dashboard.recent_sales} == {a.sale.pk}


def test_platform_dashboard_still_covers_everything(a, b) -> None:
    client = Client()
    client.force_login(User.objects.create_superuser(username="plateforme"))

    dashboard = client.get(reverse("admin:index")).context["dashboard"]

    assert dashboard.gross_sales == Decimal("4000")


# --- Compte transféré d'un commerce à un autre -----------------------------


def _transfer_to(user, commerce: Commerce) -> None:
    # Comme la fiche Organisation de la plateforme : membres modifiés, puis
    # accès réalignés.
    OrganizationMembership.objects.filter(user=user).update(is_active=False)
    OrganizationMembership.objects.create(
        organization=commerce.organization, user=user, role=OrganizationMembership.Role.CASHIER
    )
    sync_member_access(user)


def test_former_commerce_loses_a_transferred_account(a, b, owner_a) -> None:
    _transfer_to(a.cashier, b)

    listed = set(owner_a.get(_changelist(User)).context["cl"].queryset)
    opened = owner_a.get(_change(a.cashier))
    owner_a.post(
        reverse("admin:auth_user_password_change", args=[a.cashier.pk]),
        {"password1": "Piratage123!", "password2": "Piratage123!"},
    )

    assert a.cashier not in listed
    assert opened.status_code == 302
    a.cashier.refresh_from_db()
    assert not a.cashier.check_password("Piratage123!")


def test_deactivated_member_stays_manageable_by_its_commerce(a, owner_a) -> None:
    OrganizationMembership.objects.filter(user=a.cashier).update(is_active=False)

    assert owner_a.get(_change(a.cashier)).status_code == 200


# --- « Voit les coûts et marges » ------------------------------------------


def _manager(a: Commerce, *, can_view_costs: bool) -> Client:
    manager = User.objects.create_user(username=f"manager-{can_view_costs}", is_staff=True)
    manager.groups.add(Group.objects.get(name="Gérant"))
    OrganizationMembership.objects.create(
        organization=a.organization,
        user=manager,
        role=OrganizationMembership.Role.MANAGER,
        can_view_costs=can_view_costs,
    )
    StoreAssignment.objects.create(user=manager, store=a.store)
    client = Client()
    client.force_login(manager)
    return client


def test_manager_without_cost_access_sees_no_cost_even_with_the_group(a, owner_a) -> None:
    client = _manager(a, can_view_costs=False)

    valuation = client.get(_changelist(Stock._meta.apps.get_model("inventory", "StockValuation")))
    cost_log = client.get(reverse("admin:inventory_stockcostchange_changelist"))
    index = client.get(reverse("admin:index"))
    card = client.get(_change(a.product)).context["product_card"]

    assert valuation.status_code == 403
    assert cost_log.status_code == 403
    assert index.context["dashboard"].profitability is None
    assert reverse("admin:inventory_stockvaluation_changelist").encode() not in index.content
    assert card.can_view_costs is False
    assert all(stock.average_cost is None for stock in card.stocks)


def test_manager_with_cost_access_and_owner_see_costs(a, owner_a) -> None:
    client = _manager(a, can_view_costs=True)

    for allowed in (client, owner_a):
        assert allowed.get(reverse("admin:inventory_stockvaluation_changelist")).status_code == 200
        assert allowed.get(reverse("admin:index")).context["dashboard"].profitability is not None


def test_cashier_never_sees_costs_whatever_its_permissions(a) -> None:
    from django.contrib.auth.models import Permission

    a.cashier.user_permissions.add(
        Permission.objects.get(codename="view_stockvaluation"),
        Permission.objects.get(codename="view_profitability"),
    )
    a.cashier = User.objects.get(pk=a.cashier.pk)  # cache de permissions neuf

    assert not a.cashier.has_perm("inventory.view_stockvaluation")
    assert not a.cashier.has_perm("sales.view_profitability")
    OrganizationMembership.objects.filter(user=a.cashier).update(
        role=OrganizationMembership.Role.MANAGER, can_view_costs=True
    )
    assert User.objects.get(pk=a.cashier.pk).has_perm("inventory.view_stockvaluation")


# --- Créations de la plateforme : toujours dans un commerce -----------------


@pytest.fixture
def platform() -> Client:
    client = Client()
    client.force_login(User.objects.create_superuser(username="plateforme"))
    return client


def _product_post(**extra) -> dict:
    return {
        "name": "Soda",
        "selling_price": "500",
        "sale_unit": "UNIT",
        "is_active": "on",
        "initial_quantity": "0",
        **extra,
    }


def test_platform_must_choose_the_commerce_of_a_product(a, b, platform) -> None:
    url = reverse("admin:catalog_product_add")

    missing = platform.post(url, _product_post())
    mismatched = platform.post(
        url,
        _product_post(
            organization=a.organization.pk,
            initial_store=b.store.pk,
            initial_quantity="5",
            purchase_price="300",
        ),
    )
    created = platform.post(url, _product_post(organization=b.organization.pk))

    assert "organization" in missing.context["adminform"].form.errors
    assert "initial_store" in mismatched.context["adminform"].form.errors
    assert created.status_code == 302
    assert Product.objects.get(name="Soda").organization == b.organization


def test_platform_must_choose_the_commerce_of_a_store_and_a_category(a, platform) -> None:
    store = platform.post(reverse("admin:stores_store_add"), {"name": "Orphelin", "is_active": "on"})
    category = platform.post(
        reverse("admin:expenses_expensecategory_add"),
        {"name": "Orpheline", "sort_order": "0", "is_active": "on"},
    )

    assert "organization" in store.context["adminform"].form.errors
    assert "organization" in category.context["adminform"].form.errors
    assert not Store.objects.filter(name="Orphelin").exists()
    assert not ExpenseCategory.objects.filter(name="Orpheline").exists()


# Champs qui portent un coût d'achat ou une valeur au coût.
COST_FIELDS = {
    "unit_cost",
    "average_unit_cost",
    "previous_cost",
    "new_cost",
    "unit_cost_display",
    "average_cost_display",
    "cost_value_display",
    "previous_cost_display",
    "new_cost_display",
}


def _change_page_fields(client: Client, obj) -> set[str] | None:
    from django.contrib.admin.utils import flatten_fieldsets

    response = client.get(_change(obj))
    if response.status_code != 200:
        return None
    return set(flatten_fieldsets(response.context["adminform"].fieldsets))


def test_no_change_page_shows_a_cost_to_a_manager_without_cost_access(a, owner_a) -> None:
    """Garde-fou : sur chaque fiche de l'admin, aucun champ de coût pour un
    gérant à qui le propriétaire n'a pas ouvert les coûts."""
    client = _manager(a, can_view_costs=False)
    tenant = resolve_tenant(User.objects.get(username="manager-False"))
    opened = 0
    for model in admin.site._registry:
        if model in PLATFORM_ADMINS or model is User:
            continue
        obj = scope(model.objects, tenant).first()
        if obj is None:
            continue
        fields = _change_page_fields(client, obj)
        if fields is None:  # pas de droit de lecture sur ce modèle
            continue
        assert not fields & COST_FIELDS, f"{model.__name__}: {fields & COST_FIELDS}"
        opened += 1
    assert opened >= 10


def test_sale_line_cost_shows_only_with_cost_access(a, owner_a) -> None:
    line = a.sale.items.get()

    hidden = _change_page_fields(_manager(a, can_view_costs=False), line)
    shown = _change_page_fields(_manager(a, can_view_costs=True), line)

    assert "unit_cost" not in hidden
    assert "unit_cost" in shown
