import pytest
from django.contrib.auth import get_user_model
from django.db.models.signals import post_save

from apps.expenses.models import ExpenseCategory
from apps.tenancy.models import Organization, OrganizationMembership


def pytest_configure(config) -> None:
    config.addinivalue_line(
        "markers",
        "explicit_tenancy: le test crée lui-même organisations et membres "
        "(pas d'organisation pilote implicite).",
    )


@pytest.fixture(autouse=True)
def pilot_organization(request):
    """Reproduit une installation à un seul commerce, comme le pilote après
    migration : les catégories existantes et tout magasin, produit ou
    catégorie créé ensuite y sont rattachés
    (`Organization.objects.sole()`), et chaque compte autre que
    super-utilisateur en est membre — propriétaire s'il est staff (l'accès
    à tous les magasins qu'il avait avant les organisations), caissier sinon.

    Les tests d'isolation entre commerces s'en passent avec
    `@pytest.mark.explicit_tenancy`.
    """
    if request.node.get_closest_marker("explicit_tenancy") or not _uses_db(request):
        yield None
        return

    organization = Organization.objects.create(name="Commerce pilote", slug="pilote-test")
    # Comme la migration 0002 : les catégories semées par migration
    # appartiennent au commerce pilote.
    ExpenseCategory.objects.filter(organization__isnull=True).update(organization=organization)

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
    try:
        yield organization
    finally:
        post_save.disconnect(sender=User, dispatch_uid="tests.join_pilot")


def _uses_db(request) -> bool:
    marker = request.node.get_closest_marker("django_db")
    return marker is not None or "db" in request.fixturenames
