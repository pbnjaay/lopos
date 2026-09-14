from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError
from django.db import connection


class Command(BaseCommand):
    help = (
        "Usage unique, à lancer à la main juste avant le vrai lancement : "
        "supprime TOUTES les données (boutiques, caisses, produits, stocks, "
        "ventes, comptes — y compris les comptes de démo caissier/admin créés "
        "par seed_demo) en gardant le schéma et les migrations intacts. "
        "Ne fait JAMAIS partie du pipeline de déploiement automatique — "
        "voir le Dockerfile, qui ne lance que migrate."
    )

    def add_arguments(self, parser) -> None:
        parser.add_argument(
            "--yes",
            action="store_true",
            help="Ignore la confirmation interactive (scripts uniquement — dangereux).",
        )

    def handle(self, *args, **options) -> None:
        db = connection.settings_dict
        target = f"{db['HOST'] or 'local'}:{db['PORT'] or '?'}/{db['NAME']}"

        self.stdout.write(
            self.style.WARNING(
                f"\nCeci va supprimer TOUTES les données de : {target}\n"
                "Boutiques, caisses, produits, stocks, ventes, comptes "
                "utilisateurs (y compris les comptes de démo caissier/admin) "
                "— tout. Irréversible. Le schéma et les migrations restent "
                "intacts, rien d'autre.\n"
            )
        )

        if not options["yes"]:
            confirmation = input(
                f'Tapez le nom de la base ("{db["NAME"]}") pour confirmer : '
            )
            if confirmation != db["NAME"]:
                raise CommandError("Confirmation invalide — rien n'a été supprimé.")

        self.stdout.write("Suppression des données…")
        call_command("flush", interactive=False)

        self.stdout.write("Resynchronisation des groupes Gérant/Caissier…")
        call_command("create_default_groups")

        self.stdout.write(
            self.style.SUCCESS(
                "\nBase vidée. Étapes suivantes :\n"
                "  1. python backend/manage.py createsuperuser "
                "(compte réel — plus de admin123)\n"
                "  2. Se connecter à /admin/ et configurer boutique(s), "
                "caisse(s), catalogue.\n"
            )
        )
