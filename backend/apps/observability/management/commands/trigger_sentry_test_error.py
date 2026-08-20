from django.conf import settings
from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    help = "Déclenche une exception contrôlée pour vérifier l'intégration Sentry (dev/staging uniquement)."

    def handle(self, *args, **options):
        if settings.SENTRY_ENVIRONMENT == "production":
            raise CommandError(
                "trigger_sentry_test_error est désactivé en environnement production."
            )
        if not settings.SENTRY_DSN:
            self.stdout.write(
                self.style.WARNING("SENTRY_DSN est vide : rien ne sera envoyé à Sentry.")
            )
        raise RuntimeError("Sentry test error — trigger_sentry_test_error command")
