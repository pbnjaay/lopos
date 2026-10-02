"""La migration multi-organisation, rejouée sur des données d'avant.

Chaque test revient à l'état précédant une migration, y crée des données
avec les modèles historiques, puis réapplique tout jusqu'au bout.
"""

from decimal import Decimal
from uuid import uuid4

import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor

from apps.catalog.models import Product
from apps.expenses.models import ExpenseCategory
from apps.stores.models import Store
from apps.sync.models import ProcessedSyncEvent
from apps.tenancy.models import Organization, OrganizationMembership

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.explicit_tenancy]


@pytest.fixture
def migrate_back():
    """Ramène `app` à `migration` (le reste à jour) et renvoie les modèles
    historiques ; tout est réappliqué à la fin du test, même en échec."""

    def _migrate_back(app: str, migration: str, *others: tuple[str, str]):
        nodes = [(app, migration), *others]
        executor = MigrationExecutor(connection)
        apps_back = {node[0] for node in nodes}
        targets = [
            node for node in executor.loader.graph.leaf_nodes() if node[0] not in apps_back
        ] + nodes
        executor.migrate(targets)
        executor.loader.build_graph()
        return executor.loader.project_state(targets).apps

    yield _migrate_back
    _migrate_all()


def _migrate_all():
    executor = MigrationExecutor(connection)
    executor.migrate(executor.loader.graph.leaf_nodes())


def test_existing_install_joins_a_pilot_organization(migrate_back) -> None:
    apps = migrate_back("tenancy", "0001_initial")
    Group = apps.get_model("auth", "Group")
    User = apps.get_model("auth", "User")
    manager_group, _ = Group.objects.get_or_create(name="Gérant")
    manager = User.objects.create(username="gerant", is_staff=True)
    manager.groups.add(manager_group)
    User.objects.create(username="caissier")
    User.objects.create(username="ancien", is_active=False)
    User.objects.create(username="plateforme", is_superuser=True, is_staff=True)
    apps.get_model("stores", "Store").objects.create(name="Louga Centre")
    apps.get_model("catalog", "Product").objects.create(
        name="Riz 1kg", selling_price=Decimal("700")
    )
    apps.get_model("expenses", "ExpenseCategory").objects.get_or_create(name="Électricité")

    _migrate_all()

    organization = Organization.objects.get()
    assert (organization.name, organization.slug) == ("Organisation pilote", "pilote")
    assert organization.status == Organization.Status.ACTIVE
    assert not Store.objects.filter(organization__isnull=True).exists()
    assert not Product.objects.filter(organization__isnull=True).exists()
    assert not ExpenseCategory.objects.filter(organization__isnull=True).exists()
    memberships = {
        m.user.username: (m.role, m.can_view_costs, m.is_active)
        for m in OrganizationMembership.objects.select_related("user")
    }
    assert memberships == {
        "gerant": (OrganizationMembership.Role.MANAGER, True, True),
        "caissier": (OrganizationMembership.Role.CASHIER, False, True),
        "ancien": (OrganizationMembership.Role.CASHIER, False, False),
    }


def test_no_owner_is_ever_guessed(migrate_back) -> None:
    apps = migrate_back("tenancy", "0001_initial")
    apps.get_model("auth", "User").objects.create(username="seul", is_staff=True)
    apps.get_model("stores", "Store").objects.create(name="Louga Centre")

    _migrate_all()

    assert not OrganizationMembership.objects.filter(
        role=OrganizationMembership.Role.OWNER
    ).exists()


def test_fresh_install_gets_no_organization(migrate_back) -> None:
    apps = migrate_back("tenancy", "0001_initial")
    apps.get_model("auth", "User").objects.create(username="plateforme", is_superuser=True)

    _migrate_all()

    assert not Organization.objects.exists()


def test_existing_organization_gets_no_pilot_and_no_guessed_member(migrate_back) -> None:
    apps = migrate_back("tenancy", "0001_initial")
    apps.get_model("tenancy", "Organization").objects.create(name="Déjà là", slug="deja")
    apps.get_model("auth", "User").objects.create(username="caissier")
    apps.get_model("stores", "Store").objects.create(name="Louga Centre")

    _migrate_all()

    assert list(Organization.objects.values_list("slug", flat=True)) == ["deja"]
    assert not OrganizationMembership.objects.exists()
    # Le passage en NOT NULL rattache le magasin resté seul au commerce unique.
    assert Store.objects.get().organization.slug == "deja"


def test_reverting_detaches_and_removes_the_pilot_organization(migrate_back) -> None:
    apps = migrate_back("tenancy", "0001_initial")
    apps.get_model("auth", "User").objects.create(username="caissier")
    apps.get_model("stores", "Store").objects.create(name="Louga Centre")
    _migrate_all()

    migrate_back("tenancy", "0001_initial")

    assert not Organization.objects.exists()
    assert not OrganizationMembership.objects.exists()
    assert Store.objects.get().organization_id is None


def test_sync_events_take_the_store_of_their_sale(migrate_back) -> None:
    apps = migrate_back("sync", "0002_processed_sync_event_pushed_by")
    User = apps.get_model("auth", "User")
    cashier = User.objects.create(username="caissier")
    organization = apps.get_model("tenancy", "Organization").objects.create(
        name="Boutique Ndiaye", slug="ndiaye"
    )
    store = apps.get_model("stores", "Store").objects.create(
        name="Louga Centre", organization=organization
    )
    register = apps.get_model("stores", "CashRegister").objects.create(
        store=store, name="Caisse 1"
    )
    session = apps.get_model("cash", "CashSession").objects.create(
        cash_register=register, cashier=cashier, opening_balance=Decimal("0")
    )
    sale = apps.get_model("sales", "Sale").objects.create(
        cash_session=session,
        cashier=cashier,
        subtotal=Decimal("1000"),
        total=Decimal("1000"),
        status="COMPLETED",
    )
    Event = apps.get_model("sync", "ProcessedSyncEvent")
    synced = Event.objects.create(
        event_id=uuid4(), terminal_id=uuid4(), event_type="SALE_COMPLETED", entity_id=sale.id
    )
    orphan = Event.objects.create(
        event_id=uuid4(), terminal_id=uuid4(), event_type="SALE_COMPLETED", entity_id=uuid4()
    )

    _migrate_all()

    assert ProcessedSyncEvent.objects.get(pk=synced.pk).store_id == store.pk
    assert ProcessedSyncEvent.objects.get(pk=orphan.pk).store_id is None


def test_staff_managers_keep_access_to_every_store_of_their_organization(migrate_back) -> None:
    apps = migrate_back("tenancy", "0002_pilot_organization")
    User = apps.get_model("auth", "User")
    Organization = apps.get_model("tenancy", "Organization")
    Membership = apps.get_model("tenancy", "OrganizationMembership")
    Store = apps.get_model("stores", "Store")
    Assignment = apps.get_model("stores", "StoreAssignment")
    ndiaye = Organization.objects.create(name="Boutique Ndiaye", slug="ndiaye")
    fall = Organization.objects.create(name="Supérette Fall", slug="fall")
    louga = Store.objects.create(name="Louga", organization=ndiaye)
    Store.objects.create(name="Marché", organization=ndiaye)
    retired = Store.objects.create(name="Ancien dépôt", organization=ndiaye)
    Store.objects.create(name="Dakar", organization=fall)
    manager = User.objects.create(username="gerant", is_staff=True)
    Membership.objects.create(organization=ndiaye, user=manager, role="MANAGER")
    Assignment.objects.create(user=manager, store=louga)
    Assignment.objects.create(user=manager, store=retired, is_active=False)
    cashier = User.objects.create(username="caissier")
    Membership.objects.create(organization=ndiaye, user=cashier, role="CASHIER")
    not_staff = User.objects.create(username="gerant-sans-admin")
    Membership.objects.create(organization=ndiaye, user=not_staff, role="MANAGER")

    _migrate_all()

    from apps.stores.models import StoreAssignment

    assignments = {
        (a.user.username, a.store.name): a.is_active
        for a in StoreAssignment.objects.select_related("user", "store")
    }
    assert assignments == {
        ("gerant", "Louga"): True,
        ("gerant", "Marché"): True,
        # Désactivée exprès : la migration ne la réactive pas.
        ("gerant", "Ancien dépôt"): False,
    }


# --- Phase 6 : magasins, produits et catégories toujours dans un commerce --


BEFORE_NOT_NULL = (
    ("stores", "0004_store_organization"),
    ("catalog", "0009_unique_per_organization"),
    ("expenses", "0005_unique_per_organization"),
)


def test_not_null_guard_attaches_orphans_to_the_only_commerce(migrate_back) -> None:
    apps = migrate_back(*BEFORE_NOT_NULL[0], *BEFORE_NOT_NULL[1:])
    apps.get_model("tenancy", "Organization").objects.create(name="Seul", slug="seul")
    apps.get_model("stores", "Store").objects.create(name="Orphelin")
    apps.get_model("catalog", "Product").objects.create(name="Riz", selling_price=Decimal("700"))
    apps.get_model("expenses", "ExpenseCategory").objects.create(name="Loyer")

    _migrate_all()

    for model in (Store, Product, ExpenseCategory):
        assert {obj.organization.slug for obj in model.objects.all()} == {"seul"}, model


def test_not_null_guard_drops_unused_seed_categories_of_a_fresh_install(migrate_back) -> None:
    apps = migrate_back(*BEFORE_NOT_NULL[0], *BEFORE_NOT_NULL[1:])
    Category = apps.get_model("expenses", "ExpenseCategory")
    Category.objects.all().delete()
    Category.objects.create(name="Électricité")

    _migrate_all()

    assert not ExpenseCategory.objects.exists()


def test_not_null_guard_refuses_to_guess_between_commerces(migrate_back) -> None:
    apps = migrate_back(*BEFORE_NOT_NULL[0], *BEFORE_NOT_NULL[1:])
    Organization_ = apps.get_model("tenancy", "Organization")
    Organization_.objects.create(name="A", slug="a")
    Organization_.objects.create(name="B", slug="b")
    orphan = apps.get_model("stores", "Store").objects.create(name="Orphelin")

    with pytest.raises(RuntimeError, match="1 magasin\\(s\\) sans organisation"):
        _migrate_all()

    # Corrigé comme le message le demande, la migration passe.
    apps.get_model("stores", "Store").objects.filter(pk=orphan.pk).update(
        organization=Organization_.objects.get(slug="a")
    )
    _migrate_all()
    assert Store.objects.get().organization.slug == "a"

