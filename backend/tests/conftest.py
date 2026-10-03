import pytest
from django.contrib.auth import get_user_model
from django.db.models.signals import post_save, pre_save

from apps.catalog.models import Product
from apps.expenses.models import ExpenseCategory
from apps.expenses.services import ensure_default_categories
from apps.stores.models import Store
from apps.tenancy.models import Organization, OrganizationMembership

PILOT_CATALOG_MODELS = (Store, Product, ExpenseCategory)


def pytest_configure(config) -> None:
    config.addinivalue_line(
        "markers",
        "explicit_tenancy: le test crée lui-même organisations et membres "
        "(pas d'organisation pilote implicite).",
    )


@pytest.fixture(autouse=True)
def pilot_organization(request):
    """Reproduit une installation à un seul commerce, comme le pilote après
    migration : il a ses catégories de dépenses, tout magasin, produit ou
    catégorie créé sans commerce y est rattaché, et chaque compte autre que
    super-utilisateur en est membre — propriétaire s'il est staff (l'accès
    à tous les magasins qu'il avait avant les organisations), caissier sinon.

    Les tests d'isolation entre commerces s'en passent avec
    `@pytest.mark.explicit_tenancy`.
    """
    if request.node.get_closest_marker("explicit_tenancy") or not _uses_db(request):
        yield None
        return

    organization = Organization.objects.create(name="Commerce pilote", slug="pilote-test")
    # Comme le pilote réel : ses catégories de dépenses par défaut.
    ensure_default_categories(organization)

    def join_pilot_catalog(sender, instance, raw=False, **kwargs) -> None:
        # Raccourci de test : un magasin, produit ou catégorie créé sans
        # commerce rejoint le commerce pilote (le code de production, lui,
        # le précise toujours — la colonne est obligatoire).
        if not raw and instance._state.adding and instance.organization_id is None:
            instance.organization = organization

    def join_pilot(sender, instance, raw=False, **kwargs) -> None:
        if raw:
            return
        if instance.is_superuser:
            OrganizationMembership.objects.filter(user=instance).delete()
            return
        role = (
            OrganizationMembership.Role.OWNER
            if instance.is_staff
            else OrganizationMembership.Role.CASHIER
        )
        OrganizationMembership.objects.update_or_create(
            user=instance,
            organization=organization,
            defaults={"role": role, "is_active": True},
        )

    User = get_user_model()
    post_save.connect(join_pilot, sender=User, dispatch_uid="tests.join_pilot")
    for model in PILOT_CATALOG_MODELS:
        pre_save.connect(join_pilot_catalog, sender=model, dispatch_uid=f"tests.pilot.{model.__name__}")
    try:
        yield organization
    finally:
        post_save.disconnect(sender=User, dispatch_uid="tests.join_pilot")
        for model in PILOT_CATALOG_MODELS:
            pre_save.disconnect(sender=model, dispatch_uid=f"tests.pilot.{model.__name__}")


def _uses_db(request) -> bool:
    marker = request.node.get_closest_marker("django_db")
    return marker is not None or "db" in request.fixturenames


@pytest.fixture(autouse=True)
def clear_cache():
    """Les compteurs d'échecs de connexion ne passent jamais d'un test à
    l'autre."""
    from django.core.cache import cache

    cache.clear()
    yield
    cache.clear()
