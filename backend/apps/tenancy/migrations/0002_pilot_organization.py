"""Rattache l'installation existante à une organisation « pilote ».

Déterministe, sans rien deviner :
- ne fait rien si une organisation existe déjà, ni sur une base vierge
  (aucun magasin, aucun compte autre que super-utilisateur) ;
- rattache tous les magasins, produits et catégories de dépenses ;
- donne à chaque compte non super-utilisateur un membre dont le rôle suit
  son groupe actuel : « Gérant » → gérant (coûts visibles, comme le groupe
  aujourd'hui), sinon caissier. Personne ne gagne de droit : aucun
  propriétaire n'est créé, il est promu à la main ensuite ;
- les super-utilisateurs restent administrateurs de la plateforme, sans
  organisation.
"""

from django.db import migrations

PILOT_NAME = "Organisation pilote"
PILOT_SLUG = "pilote"
# Copie figée de `create_default_groups.MANAGER_GROUP`.
MANAGER_GROUP = "Gérant"


def create_pilot_organization(apps, schema_editor):
    Organization = apps.get_model("tenancy", "Organization")
    OrganizationMembership = apps.get_model("tenancy", "OrganizationMembership")
    Store = apps.get_model("stores", "Store")
    Product = apps.get_model("catalog", "Product")
    ExpenseCategory = apps.get_model("expenses", "ExpenseCategory")
    User = apps.get_model("auth", "User")

    if Organization.objects.exists():
        return
    users = User.objects.filter(is_superuser=False).prefetch_related("groups")
    if not Store.objects.exists() and not users.exists():
        return

    organization = Organization.objects.create(name=PILOT_NAME, slug=PILOT_SLUG)
    Store.objects.filter(organization__isnull=True).update(organization=organization)
    Product.objects.filter(organization__isnull=True).update(organization=organization)
    ExpenseCategory.objects.filter(organization__isnull=True).update(
        organization=organization
    )

    for user in users:
        is_manager = any(group.name == MANAGER_GROUP for group in user.groups.all())
        OrganizationMembership.objects.create(
            organization=organization,
            user=user,
            role="MANAGER" if is_manager else "CASHIER",
            can_view_costs=is_manager,
            is_active=user.is_active,
        )


def remove_pilot_organization(apps, schema_editor):
    Organization = apps.get_model("tenancy", "Organization")
    organization = Organization.objects.filter(slug=PILOT_SLUG).first()
    if organization is None:
        return
    for model in (
        apps.get_model("stores", "Store"),
        apps.get_model("catalog", "Product"),
        apps.get_model("expenses", "ExpenseCategory"),
    ):
        model.objects.filter(organization=organization).update(organization=None)
    apps.get_model("tenancy", "OrganizationMembership").objects.filter(
        organization=organization
    ).delete()
    organization.delete()


class Migration(migrations.Migration):
    dependencies = [
        ("auth", "0012_alter_user_first_name_max_length"),
        ("tenancy", "0001_initial"),
        ("stores", "0004_store_organization"),
        ("catalog", "0008_product_organization"),
        ("expenses", "0004_expensecategory_organization"),
    ]

    operations = [
        migrations.RunPython(create_pilot_organization, remove_pilot_organization),
    ]
