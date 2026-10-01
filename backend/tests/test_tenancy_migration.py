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

pytestmark = pytest.mark.django_db(transaction=True)


@pytest.fixture
def migrate_back():
    """Ramène `app` à `migration` (le reste à jour) et renvoie les modèles
    historiques ; tout est réappliqué à la fin du test, même en échec."""

    def _migrate_back(app: str, migration: str):
        executor = MigrationExecutor(connection)
        targets = [
            node for node in executor.loader.graph.leaf_nodes() if node[0] != app
        ] + [(app, migration)]
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


def test_existing_organization_is_left_alone(migrate_back) -> None:
    apps = migrate_back("tenancy", "0001_initial")
    apps.get_model("tenancy", "Organization").objects.create(name="Déjà là", slug="deja")
    apps.get_model("auth", "User").objects.create(username="caissier")
    apps.get_model("stores", "Store").objects.create(name="Louga Centre")

    _migrate_all()

    assert list(Organization.objects.values_list("slug", flat=True)) == ["deja"]
    assert not OrganizationMembership.objects.exists()
    assert Store.objects.get().organization is None


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
    store = apps.get_model("stores", "Store").objects.create(name="Louga Centre")
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
