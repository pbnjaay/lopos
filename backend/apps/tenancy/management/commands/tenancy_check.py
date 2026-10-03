from django.core.management.base import BaseCommand, CommandError

from apps.tenancy.integrity import find_violations, integrity_rules


class Command(BaseCommand):
    help = (
        "Lecture seule : vérifie qu'aucune donnée ne relie deux commerces (vente "
        "d'un produit ou d'un client d'ailleurs, dépense dans une catégorie "
        "étrangère…). Échoue (code de sortie non nul) à la moindre incohérence : "
        "à lancer après chaque migration, et en intégration continue."
    )

    def add_arguments(self, parser) -> None:
        parser.add_argument(
            "--show",
            type=int,
            default=5,
            help="Identifiants affichés par règle enfreinte (défaut : 5).",
        )

    def handle(self, *args, **options) -> None:
        violations = find_violations()
        self.stdout.write(f"{len(integrity_rules())} règles vérifiées.")
        if not violations:
            self.stdout.write(self.style.SUCCESS("Aucune donnée ne relie deux commerces."))
            return

        for rule, count in violations:
            sample = list(rule.violations.values_list("pk", flat=True)[: options["show"]])
            self.stdout.write(self.style.ERROR(f"  ✗ {rule.label} : {count}"))
            self.stdout.write(f"    ex. {', '.join(str(pk) for pk in sample)}")
        raise CommandError(
            f"{sum(count for _, count in violations)} ligne(s) relient deux commerces."
        )
