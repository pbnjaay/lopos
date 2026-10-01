from io import StringIO
from uuid import uuid4

import pytest
from django.contrib.auth import get_user_model
from django.core.management import call_command

from apps.cash.models import CashSession
from apps.expenses.models import ExpenseCategory
from apps.stores.models import CashRegister, Store, StoreAssignment
from apps.sync.models import ProcessedSyncEvent
from apps.tenancy.models import Organization, OrganizationMembership

pytestmark = [pytest.mark.django_db, pytest.mark.explicit_tenancy]
User = get_user_model()
Role = OrganizationMembership.Role


def _audit(*args) -> str:
    out = StringIO()
    call_command("tenancy_audit", *args, stdout=out)
    return out.getvalue()


@pytest.fixture
def organization() -> Organization:
    return Organization.objects.create(name="Boutique Ndiaye", slug="ndiaye")


@pytest.fixture
def store(organization: Organization) -> Store:
    return Store.objects.create(name="Louga Centre", organization=organization)


def test_audit_reports_organizations_stores_and_accounts(
    organization: Organization, store: Store
) -> None:
    owner = User.objects.create_user(username="awa")
    OrganizationMembership.objects.create(organization=organization, user=owner, role=Role.OWNER)
    StoreAssignment.objects.create(user=owner, store=store)
    ExpenseCategory.objects.update(organization=organization)

    output = _audit()

    assert "Boutique Ndiaye [ndiaye] Active — 1 magasin(s), 1 membre(s) actif(s), 1 propriétaire(s)" in output
    assert "Louga Centre (actif) — organisation : Boutique Ndiaye" in output
    assert "awa [actif]" in output
    assert "membre : ndiaye:Propriétaire" in output
    assert "Aucun." in output.split("== Points d'attention ==")[1]


def test_audit_is_read_only(organization: Organization, store: Store) -> None:
    User.objects.create_user(username="orphelin")

    _audit()

    assert Organization.objects.count() == 1
    assert not OrganizationMembership.objects.exists()


def test_audit_flags_missing_owner(organization: Organization) -> None:
    assert "« Boutique Ndiaye » n'a aucun propriétaire" in _audit()


def test_audit_flags_sync_events_without_store(organization: Organization) -> None:
    ProcessedSyncEvent.objects.create(
        event_id=uuid4(), terminal_id=uuid4(), event_type="SALE_COMPLETED", entity_id=uuid4()
    )

    assert "1 événements de synchronisation sans magasin à rattacher." in _audit()


def test_audit_flags_superuser_selling_at_the_register(store: Store) -> None:
    admin = User.objects.create_superuser(username="admin")
    register = CashRegister.objects.create(store=store, name="Caisse 1")
    CashSession.objects.create(cash_register=register, cashier=admin, opening_balance=0)

    output = _audit()

    assert "admin est super-utilisateur et vend en caisse" in output


def test_audit_ignores_superuser_without_register_activity(store: Store) -> None:
    User.objects.create_superuser(username="admin")

    assert "super-utilisateur et vend" not in _audit()


def test_audit_flags_accounts_outside_any_organization() -> None:
    User.objects.create_user(username="orphelin")

    assert "orphelin n'appartient à aucune organisation." in _audit()


def test_audit_flags_member_without_store(organization: Organization) -> None:
    cashier = User.objects.create_user(username="fatou")
    OrganizationMembership.objects.create(organization=organization, user=cashier, role=Role.CASHIER)

    assert "fatou n'est affecté à aucun magasin" in _audit()


def test_audit_flags_assignment_to_another_organization(
    organization: Organization, store: Store
) -> None:
    other_store = Store.objects.create(
        name="Dakar Plateau",
        organization=Organization.objects.create(name="Autre", slug="autre"),
    )
    cashier = User.objects.create_user(username="fatou")
    OrganizationMembership.objects.create(organization=organization, user=cashier, role=Role.CASHIER)
    StoreAssignment.objects.create(user=cashier, store=store)
    StoreAssignment.objects.create(user=cashier, store=other_store)

    assert "fatou est affecté à un magasin d'une autre organisation : Dakar Plateau." in _audit()


def test_audit_flags_inactive_user_with_active_membership(organization: Organization) -> None:
    user = User.objects.create_user(username="parti", is_active=False)
    OrganizationMembership.objects.create(organization=organization, user=user, role=Role.OWNER)

    assert "parti est désactivé mais reste membre actif" in _audit()
