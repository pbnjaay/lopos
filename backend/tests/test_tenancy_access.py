"""Phase 2 : contexte tenant, refus par défaut de l'API et de l'admin, rôles.

Chaque test crée lui-même ses organisations et ses membres.
"""

from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.conf import settings
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient

from apps.cash.models import CashSession
from apps.sales.exceptions import InvalidCancellation
from apps.sales.models import Sale
from apps.sales.services import cancel_sale
from apps.stores.access import user_can_access_store, user_can_manage_store
from apps.stores.models import CashRegister, Store, StoreAssignment
from apps.tenancy.context import resolve_tenant
from apps.tenancy.models import Organization, OrganizationMembership

pytestmark = [pytest.mark.django_db, pytest.mark.explicit_tenancy]
User = get_user_model()
Role = OrganizationMembership.Role
PASSWORD = "Passer1234"


@pytest.fixture
def ndiaye() -> Organization:
    return Organization.objects.create(name="Boutique Ndiaye", slug="ndiaye")


@pytest.fixture
def fall() -> Organization:
    return Organization.objects.create(name="Supérette Fall", slug="fall")


@pytest.fixture
def louga(ndiaye: Organization) -> Store:
    return Store.objects.create(name="Louga Centre", organization=ndiaye)


@pytest.fixture
def marche(ndiaye: Organization) -> Store:
    return Store.objects.create(name="Louga Marché", organization=ndiaye)


@pytest.fixture
def dakar(fall: Organization) -> Store:
    return Store.objects.create(name="Dakar Plateau", organization=fall)


def _member(organization, username, role, *, stores=(), is_staff=False, **membership):
    user = User.objects.create_user(username=username, password=PASSWORD, is_staff=is_staff)
    OrganizationMembership.objects.create(
        organization=organization, user=user, role=role, **membership
    )
    for store in stores:
        StoreAssignment.objects.create(user=user, store=store)
    return user


def _api(user) -> APIClient:
    client = APIClient()
    client.force_authenticate(user)
    return client


def _session(store: Store, cashier) -> CashSession:
    register = CashRegister.objects.create(store=store, name=f"Caisse {cashier.username}")
    return CashSession.objects.create(
        cash_register=register, cashier=cashier, opening_balance=Decimal("0")
    )


# --- Contexte tenant --------------------------------------------------------


def test_owner_reaches_every_store_of_the_organization_only(
    ndiaye, louga, marche, dakar
) -> None:
    owner = _member(ndiaye, "awa", Role.OWNER)

    tenant = resolve_tenant(owner)

    assert tenant.organization == ndiaye
    assert tenant.store_ids == {louga.pk, marche.pk}


def test_manager_and_cashier_reach_assigned_stores_only(ndiaye, louga, marche) -> None:
    manager = _member(ndiaye, "moussa", Role.MANAGER, stores=[louga])

    assert resolve_tenant(manager).store_ids == {louga.pk}


def test_assignment_to_another_organization_store_is_ignored(ndiaye, louga, dakar) -> None:
    cashier = _member(ndiaye, "fatou", Role.CASHIER, stores=[louga, dakar])

    assert resolve_tenant(cashier).store_ids == {louga.pk}
    assert not user_can_access_store(cashier, dakar)


def test_inactive_assignment_gives_no_access(ndiaye, louga) -> None:
    cashier = _member(ndiaye, "fatou", Role.CASHIER, stores=[louga])
    StoreAssignment.objects.update(is_active=False)

    assert resolve_tenant(cashier).store_ids == frozenset()


@pytest.mark.parametrize(
    "lose_access",
    [
        lambda user, org: OrganizationMembership.objects.update(is_active=False),
        lambda user, org: Organization.objects.update(status=Organization.Status.SUSPENDED),
        lambda user, org: User.objects.filter(pk=user.pk).update(is_active=False),
    ],
    ids=["membre désactivé", "organisation suspendue", "compte désactivé"],
)
def test_access_is_lost_with_membership_organization_or_account(ndiaye, louga, lose_access) -> None:
    cashier = _member(ndiaye, "fatou", Role.CASHIER, stores=[louga])
    lose_access(cashier, ndiaye)
    cashier.refresh_from_db()

    assert resolve_tenant(cashier) is None


def test_superuser_without_membership_has_no_tenant() -> None:
    assert resolve_tenant(User.objects.create_superuser(username="plateforme")) is None


@pytest.mark.parametrize(
    ("role", "flag", "expected"),
    [
        (Role.OWNER, False, True),
        (Role.MANAGER, True, True),
        (Role.MANAGER, False, False),
        (Role.CASHIER, True, False),
    ],
)
def test_who_sees_costs(ndiaye, role, flag, expected) -> None:
    user = _member(ndiaye, "membre", role, can_view_costs=flag)

    assert resolve_tenant(user).can_view_costs is expected


# --- Délégation par rôle (remplace le contournement is_staff) ---------------


def test_owner_and_assigned_manager_manage_a_store(ndiaye, louga, marche) -> None:
    owner = _member(ndiaye, "awa", Role.OWNER)
    manager = _member(ndiaye, "moussa", Role.MANAGER, stores=[louga])
    cashier = _member(ndiaye, "fatou", Role.CASHIER, stores=[louga])

    assert user_can_manage_store(owner, marche.pk)
    assert user_can_manage_store(manager, louga.pk)
    assert not user_can_manage_store(manager, marche.pk)
    assert not user_can_manage_store(cashier, louga.pk)


def test_staff_of_another_organization_cannot_manage_a_store(ndiaye, fall, louga) -> None:
    rival = _member(fall, "rival", Role.OWNER, is_staff=True)

    assert not user_can_manage_store(rival, louga.pk)
    assert not user_can_access_store(rival, louga)


def _open_sale(session: CashSession) -> Sale:
    return Sale.objects.create(
        cash_session=session,
        cashier=session.cashier,
        subtotal=Decimal("1000"),
        total=Decimal("1000"),
        status=Sale.Status.COMPLETED,
    )


def test_assigned_manager_cancels_a_colleague_sale(ndiaye, louga) -> None:
    cashier = _member(ndiaye, "fatou", Role.CASHIER, stores=[louga])
    manager = _member(ndiaye, "moussa", Role.MANAGER, stores=[louga], is_staff=True)
    sale = _open_sale(_session(louga, cashier))

    assert cancel_sale(sale_id=sale.pk, cancelled_by=manager, reason="Erreur de saisie").status == Sale.Status.CANCELLED


def test_staff_from_another_store_cannot_cancel_a_colleague_sale(ndiaye, louga, marche) -> None:
    cashier = _member(ndiaye, "fatou", Role.CASHIER, stores=[louga])
    manager = _member(ndiaye, "moussa", Role.MANAGER, stores=[marche], is_staff=True)
    sale = _open_sale(_session(louga, cashier))

    with pytest.raises(InvalidCancellation):
        cancel_sale(sale_id=sale.pk, cancelled_by=manager, reason="Erreur de saisie")


def test_cash_session_summary_is_open_to_the_store_manager_only(ndiaye, louga, marche) -> None:
    cashier = _member(ndiaye, "fatou", Role.CASHIER, stores=[louga])
    colleague = _member(ndiaye, "ibou", Role.CASHIER, stores=[louga])
    manager = _member(ndiaye, "moussa", Role.MANAGER, stores=[louga])
    elsewhere = _member(ndiaye, "khady", Role.MANAGER, stores=[marche], is_staff=True)
    session = _session(louga, cashier)
    url = reverse("cash-session-summary", kwargs={"pk": session.pk})

    assert _api(manager).get(url).status_code == status.HTTP_200_OK
    assert _api(colleague).get(url).status_code == status.HTTP_403_FORBIDDEN
    # Magasin non affecté : la session n'existe pas pour lui.
    assert _api(elsewhere).get(url).status_code == status.HTTP_404_NOT_FOUND


# --- API : refus par défaut ------------------------------------------------


def test_api_refuses_an_account_outside_any_organization() -> None:
    orphan = User.objects.create_user(username="orphelin")

    response = _api(orphan).get(reverse("store-list"))

    assert response.status_code == status.HTTP_403_FORBIDDEN
    assert response.json()["code"] == "NO_ACTIVE_MEMBERSHIP"


def test_api_refuses_the_platform_superuser() -> None:
    response = _api(User.objects.create_superuser(username="plateforme")).get(
        reverse("store-list")
    )

    assert response.status_code == status.HTTP_403_FORBIDDEN
    assert response.json()["code"] == "NO_ACTIVE_MEMBERSHIP"


def test_api_refuses_a_suspended_organization(ndiaye, louga) -> None:
    cashier = _member(ndiaye, "fatou", Role.CASHIER, stores=[louga])
    ndiaye.status = Organization.Status.SUSPENDED
    ndiaye.save()

    response = _api(cashier).get(reverse("store-list"))

    assert response.status_code == status.HTTP_403_FORBIDDEN
    assert response.json() == {
        "code": "ORGANIZATION_SUSPENDED",
        "message": "L’accès de ce commerce est suspendu.",
    }


def test_open_session_loses_access_as_soon_as_membership_is_deactivated(ndiaye, louga) -> None:
    _member(ndiaye, "fatou", Role.CASHIER, stores=[louga])
    client = APIClient()
    client.login(username="fatou", password=PASSWORD)
    assert client.get(reverse("store-list")).status_code == status.HTTP_200_OK

    OrganizationMembership.objects.update(is_active=False)

    assert client.get(reverse("store-list")).status_code == status.HTTP_403_FORBIDDEN


def test_every_api_route_requires_an_active_tenant() -> None:
    """Garde-fou : une vue qui redéfinit `permission_classes` doit garder
    `HasActiveTenant`. Seules l'authentification et le jeton CSRF y
    échappent, et la déconnexion (un membre retiré doit pouvoir sortir)."""
    from django.urls import get_resolver

    from apps.tenancy.permissions import HasActiveTenant

    exempt = {"auth-csrf", "auth-login", "auth-logout"}
    api = get_resolver().url_patterns
    checked = 0
    for pattern in _api_patterns(api):
        view = getattr(pattern.callback, "cls", None)
        if view is None or pattern.name in exempt:
            continue
        assert HasActiveTenant in view.permission_classes, pattern.name
        checked += 1
    assert checked > 20


def _api_patterns(patterns, prefix=""):
    from django.urls import URLPattern, URLResolver

    for pattern in patterns:
        route = prefix + str(pattern.pattern)
        if isinstance(pattern, URLResolver):
            yield from _api_patterns(pattern.url_patterns, route)
        elif isinstance(pattern, URLPattern) and route.startswith("api/"):
            yield pattern


# --- Connexion -------------------------------------------------------------


def _login(username: str):
    client = APIClient(enforce_csrf_checks=False)
    response = client.post(
        reverse("auth-login"), {"username": username, "password": PASSWORD}, format="json"
    )
    return client, response


def test_member_login_returns_organization_role_and_stores(ndiaye, louga, marche) -> None:
    _member(ndiaye, "moussa", Role.MANAGER, stores=[louga], can_view_costs=True)

    client, response = _login("moussa")

    assert response.status_code == status.HTTP_200_OK
    body = response.json()
    assert body["organization"] == {"id": str(ndiaye.pk), "name": "Boutique Ndiaye"}
    assert body["role"] == "MANAGER"
    assert body["store_ids"] == [str(louga.pk)]
    assert body["can_view_costs"] is True
    assert client.get(reverse("auth-me")).json() == body


@pytest.mark.parametrize(
    ("setup", "code"),
    [
        (lambda: User.objects.create_user(username="x", password=PASSWORD), "NO_ACTIVE_MEMBERSHIP"),
        (
            lambda: User.objects.create_superuser(username="x", password=PASSWORD),
            "NO_ACTIVE_MEMBERSHIP",
        ),
    ],
    ids=["sans commerce", "super-utilisateur"],
)
def test_login_without_tenant_is_refused_without_session(setup, code) -> None:
    setup()

    client, response = _login("x")

    assert response.status_code == status.HTTP_403_FORBIDDEN
    assert response.json()["code"] == code
    assert settings.SESSION_COOKIE_NAME not in client.cookies


def test_login_to_a_suspended_organization_is_refused(ndiaye, louga) -> None:
    _member(ndiaye, "fatou", Role.CASHIER, stores=[louga])
    Organization.objects.update(status=Organization.Status.SUSPENDED)

    client, response = _login("fatou")

    assert response.status_code == status.HTTP_403_FORBIDDEN
    assert response.json()["code"] == "ORGANIZATION_SUSPENDED"
    assert settings.SESSION_COOKIE_NAME not in client.cookies


def test_removed_member_can_still_log_out(ndiaye, louga) -> None:
    _member(ndiaye, "fatou", Role.CASHIER, stores=[louga])
    client = APIClient()
    client.login(username="fatou", password=PASSWORD)
    OrganizationMembership.objects.update(is_active=False)

    assert client.post(reverse("auth-logout")).status_code == status.HTTP_200_OK


# --- Back-office ------------------------------------------------------------


def _admin_index(username: str):
    from django.test import Client

    client = Client()
    client.login(username=username, password=PASSWORD)
    return client.get(reverse("admin:index"))


def test_admin_opens_to_a_staff_member_of_an_active_organization(ndiaye) -> None:
    _member(ndiaye, "awa", Role.OWNER, is_staff=True)

    assert _admin_index("awa").status_code == 200


def test_admin_stays_closed_to_staff_without_organization() -> None:
    User.objects.create_user(username="ancien", password=PASSWORD, is_staff=True)

    assert _admin_index("ancien").status_code == 302


def test_admin_stays_closed_to_a_suspended_organization(ndiaye) -> None:
    _member(ndiaye, "awa", Role.OWNER, is_staff=True)
    Organization.objects.update(status=Organization.Status.SUSPENDED)

    assert _admin_index("awa").status_code == 302


def test_admin_opens_to_the_platform_superuser() -> None:
    User.objects.create_superuser(username="plateforme", password=PASSWORD)

    assert _admin_index("plateforme").status_code == 200


def test_no_serializer_accepts_an_unscoped_foreign_key() -> None:
    """Garde-fou : toute clé étrangère reçue d'un client est cherchée dans
    le commerce du compte (`TenantPrimaryKeyRelatedField`)."""
    import importlib
    import inspect
    import pkgutil

    from rest_framework import serializers

    import apps
    from apps.tenancy.fields import TenantPrimaryKeyRelatedField

    def writable_relations(serializer):
        for name, field in serializer.fields.items():
            if isinstance(field, serializers.ListSerializer):
                field = field.child
            if isinstance(field, serializers.BaseSerializer):
                yield from writable_relations(field)
            elif isinstance(field, serializers.ManyRelatedField) and not field.read_only:
                yield name, field.child_relation
            elif isinstance(field, serializers.RelatedField) and not field.read_only:
                yield name, field

    checked = 0
    for module_info in pkgutil.iter_modules(apps.__path__):
        try:
            module = importlib.import_module(f"apps.{module_info.name}.serializers")
        except ModuleNotFoundError:
            continue
        for _, cls in inspect.getmembers(module, inspect.isclass):
            if not issubclass(cls, serializers.BaseSerializer) or cls.__module__ != module.__name__:
                continue
            for name, field in writable_relations(cls()):
                assert isinstance(field, TenantPrimaryKeyRelatedField), f"{cls.__name__}.{name}"
                checked += 1
    assert checked >= 9
