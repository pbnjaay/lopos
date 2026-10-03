"""Garde aux gérants l'accès qu'ils avaient avant les organisations.

Jusqu'ici, `is_staff` ouvrait tous les magasins sans affectation. Ce
contournement disparaît : un gérant n'accède plus qu'aux magasins où il est
affecté. Chaque gérant actif et staff reçoit donc une affectation à chaque
magasin de son organisation qu'il n'a pas encore. Une affectation existante
n'est jamais modifiée : une affectation désactivée l'avait été exprès.
"""

from django.db import migrations


def assign_managers_to_their_stores(apps, schema_editor):
    OrganizationMembership = apps.get_model("tenancy", "OrganizationMembership")
    Store = apps.get_model("stores", "Store")
    StoreAssignment = apps.get_model("stores", "StoreAssignment")

    managers = OrganizationMembership.objects.filter(
        role="MANAGER", is_active=True, user__is_active=True, user__is_staff=True
    )
    for membership in managers:
        already = StoreAssignment.objects.filter(user_id=membership.user_id).values(
            "store_id"
        )
        StoreAssignment.objects.bulk_create(
            StoreAssignment(user_id=membership.user_id, store=store, is_active=True)
            for store in Store.objects.filter(
                organization_id=membership.organization_id
            ).exclude(pk__in=already)
        )


class Migration(migrations.Migration):
    dependencies = [
        ("tenancy", "0002_pilot_organization"),
        ("stores", "0004_store_organization"),
    ]

    operations = [
        # Pas de retour arrière : une affectation créée ici ne se distingue
        # plus d'une affectation saisie à la main ensuite.
        migrations.RunPython(assign_managers_to_their_stores, migrations.RunPython.noop),
    ]
