from io import StringIO

from django.contrib.auth.models import Group
from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError
from django.utils.text import slugify

from apps.tenancy.onboarding import DEFAULT_REGISTER_NAME, OnboardingError, create_pilot
from apps.tenancy.roles import OWNER_GROUP


class Command(BaseCommand):
    help = (
        "Accueille un commerce pilote en une fois : commerce, catégories de "
        "dépenses par défaut, premier magasin, première caisse et compte "
        "propriétaire avec un mot de passe temporaire, affiché une seule fois. "
        "Tout ou rien."
    )

    def add_arguments(self, parser) -> None:
        parser.add_argument("--name", required=True, help="Nom du commerce (ex. « Boutique Ndiaye »).")
        parser.add_argument(
            "--slug",
            help="Identifiant court et stable (défaut : dérivé du nom, ex. « boutique-ndiaye »).",
        )
        parser.add_argument("--store", required=True, help="Nom du premier magasin.")
        parser.add_argument(
            "--owner",
            required=True,
            help="Nom d'utilisateur du propriétaire (convention : <slug>.<prénom>).",
        )
        parser.add_argument("--owner-first-name", default="")
        parser.add_argument("--owner-last-name", default="")
        parser.add_argument(
            "--register",
            default=DEFAULT_REGISTER_NAME,
            help=f"Nom de la première caisse (défaut : « {DEFAULT_REGISTER_NAME} »).",
        )
        parser.add_argument(
            "--no-register",
            action="store_true",
            help="Ne pas créer de caisse (le propriétaire la créera).",
        )

    def handle(self, *args, **options) -> None:
        slug = options["slug"] or slugify(options["name"])
        if not slug:
            raise CommandError("Identifiant de commerce vide : précisez --slug.")
        self._ensure_role_groups()

        try:
            pilot = create_pilot(
                name=options["name"].strip(),
                slug=slug,
                store_name=options["store"].strip(),
                owner_username=options["owner"].strip(),
                owner_first_name=options["owner_first_name"].strip(),
                owner_last_name=options["owner_last_name"].strip(),
                register_name=None if options["no_register"] else options["register"].strip(),
            )
        except OnboardingError as exc:
            raise CommandError(str(exc)) from exc

        self.stdout.write(self.style.SUCCESS(f"\nCommerce créé : {pilot.organization.name} [{slug}]"))
        self.stdout.write(f"  Magasin : {pilot.store.name}")
        self.stdout.write(
            f"  Caisse : {pilot.register.name}" if pilot.register else "  Caisse : aucune"
        )
        self.stdout.write(f"  Catégories de dépenses : {pilot.expense_categories}")
        self.stdout.write("\nCompte propriétaire — à transmettre en main propre :")
        self.stdout.write(f"  Utilisateur : {pilot.owner.username}")
        self.stdout.write(f"  Mot de passe temporaire : {pilot.owner_password}")
        self.stdout.write(
            self.style.WARNING(
                "  Ce mot de passe ne sera plus jamais affiché. Le propriétaire le "
                "change dans l'administration (Utilisateurs › Changer le mot de passe)."
            )
        )

    def _ensure_role_groups(self) -> None:
        """Sans les groupes de rôle, le propriétaire n'aurait aucun droit."""
        owner_group = Group.objects.filter(name=OWNER_GROUP).first()
        if owner_group is None or not owner_group.permissions.exists():
            call_command("create_default_groups", stdout=StringIO())
            self.stdout.write("Groupes de rôle créés (create_default_groups).")
