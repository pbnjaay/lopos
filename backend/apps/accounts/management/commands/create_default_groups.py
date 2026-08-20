from django.contrib.auth.models import Group, Permission
from django.core.management.base import BaseCommand

MANAGER_GROUP = "Gérant"
CASHIER_GROUP = "Caissier"

# (app_label, model, [codename actions]) — view-only for models the back-office
# never edits directly (audit trail), add/change/view for catalog and store setup.
MANAGER_PERMISSIONS = [
    ("catalog", "product", ("add", "change", "delete", "view")),
    ("stores", "store", ("add", "change", "view")),
    ("stores", "cashregister", ("add", "change", "view")),
    ("inventory", "stock", ("view",)),
    ("inventory", "inventorymovement", ("view",)),
    ("cash", "cashsession", ("view",)),
    ("sales", "sale", ("view",)),
    ("sales", "saleitem", ("view",)),
    ("sales", "payment", ("view",)),
    ("sync", "processedsyncevent", ("view",)),
]


class Command(BaseCommand):
    help = (
        "Crée (ou met à jour) les groupes métier « Gérant » et « Caissier ». "
        "Le gérant a accès au back-office Unfold ; le caissier travaille dans le POS "
        "et n'a besoin d'aucune permission d'administration."
    )

    def handle(self, *args, **options) -> None:
        manager_group, created = Group.objects.get_or_create(name=MANAGER_GROUP)
        self._report(MANAGER_GROUP, created)

        permissions = []
        for app_label, model, actions in MANAGER_PERMISSIONS:
            for action in actions:
                codename = f"{action}_{model}"
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
        manager_group.permissions.set(permissions)

        cashier_group, created = Group.objects.get_or_create(name=CASHIER_GROUP)
        self._report(CASHIER_GROUP, created)
        cashier_group.permissions.clear()

        self.stdout.write(self.style.SUCCESS("\nGroupes métier synchronisés."))

    def _report(self, name: str, created: bool) -> None:
        marker = "+" if created else "="
        self.stdout.write(f"  {marker} Groupe : {name}")
