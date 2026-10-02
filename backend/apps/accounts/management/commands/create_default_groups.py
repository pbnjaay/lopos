from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group, Permission
from django.core.management.base import BaseCommand

from apps.tenancy.roles import CASHIER_GROUP, MANAGER_GROUP, OWNER_GROUP, sync_member_access

# (app_label, model, [codename actions]) — view-only for models the back-office
# never edits directly (audit trail), add/change/view for catalog and store setup.
MANAGER_PERMISSIONS = [
    ("catalog", "product", ("add", "change", "delete", "view")),
    # Le gérant voit magasins et caisses ; les créer ou les modifier, comme
    # gérer les comptes et leurs affectations, revient au propriétaire.
    ("stores", "store", ("view",)),
    ("stores", "cashregister", ("view",)),
    ("inventory", "stock", ("view",)),
    ("inventory", "inventorymovement", ("view",)),
    # Valorisation : coût d'achat et marges visibles ; « set_cost » définit
    # ou corrige un coût moyen, toujours tracé dans le journal des coûts.
    ("inventory", "stockvaluation", ("view", "set_cost")),
    ("inventory", "stockcostchange", ("view",)),
    ("cash", "cashsession", ("view",)),
    ("sales", "sale", ("view",)),
    # Permission sur mesure, déjà complète : pas de suffixe de modèle.
    ("sales", None, ("view_profitability",)),
    ("sales", "saleitem", ("view",)),
    ("sales", "payment", ("view",)),
    # Pas de "delete" : un client se désactive (historique du cahier).
    ("customers", "customer", ("add", "change", "view")),
    # "add" = ajustement ou solde d'ouverture saisi à la main ; jamais de
    # "change"/"delete", une écriture du cahier est immuable.
    ("customers", "customerledgerentry", ("add", "view")),
    ("customers", "customerpayment", ("view",)),
    # Pas de "add"/"change"/"delete" : une dépense se saisit en caisse et
    # ne se corrige que par annulation (motif obligatoire).
    ("expenses", "expense", ("view", "cancel")),
    # Pas de "delete" : une catégorie se désactive (dépenses rattachées).
    ("expenses", "expensecategory", ("add", "change", "view")),
    ("sync", "processedsyncevent", ("view",)),
]

# Le propriétaire : tout ce que fait le gérant, plus son commerce lui-même.
OWNER_PERMISSIONS = [
    *MANAGER_PERMISSIONS,
    ("stores", "store", ("add", "change")),
    ("stores", "cashregister", ("add", "change")),
    ("stores", "storeassignment", ("add", "change", "delete", "view")),
    # Pas de "delete" : un compte se désactive, il ne se supprime jamais
    # (perte de l'historique des ventes liées). UserAdmin retire en plus
    # is_staff/is_superuser/groups/permissions du formulaire : un
    # propriétaire ne peut pas s'accorder plus que son rôle.
    ("auth", "user", ("add", "change", "view")),
]


class Command(BaseCommand):
    help = (
        "Crée (ou met à jour) les groupes de rôle « Propriétaire », « Gérant » et "
        "« Caissier », puis réaligne les groupes de chaque compte sur son rôle de "
        "membre. Propriétaire et gérant ont accès au back-office Unfold ; le "
        "caissier travaille dans le POS et n'a aucune permission d'administration."
    )

    def handle(self, *args, **options) -> None:
        self._sync_group(OWNER_GROUP, OWNER_PERMISSIONS)
        self._sync_group(MANAGER_GROUP, MANAGER_PERMISSIONS)
        self._sync_group(CASHIER_GROUP, [])

        members = get_user_model().objects.filter(is_superuser=False).order_by("pk")
        for user in members:
            sync_member_access(user)
        self.stdout.write(f"  = Comptes réalignés sur leur rôle : {members.count()}")

        self.stdout.write(self.style.SUCCESS("\nGroupes métier synchronisés."))

    def _sync_group(self, name: str, specs) -> None:
        group, created = Group.objects.get_or_create(name=name)
        self._report(name, created)

        permissions = []
        for app_label, model, actions in specs:
            for action in actions:
                codename = action if model is None else f"{action}_{model}"
                try:
                    permissions.append(
                        Permission.objects.get(
                            content_type__app_label=app_label, codename=codename
                        )
                    )
                except Permission.DoesNotExist:
                    self.stderr.write(
                        f"  permission introuvable : {app_label}.{codename}"
                    )
        group.permissions.set(permissions)

    def _report(self, name: str, created: bool) -> None:
        marker = "+" if created else "="
        self.stdout.write(f"  {marker} Groupe : {name}")
