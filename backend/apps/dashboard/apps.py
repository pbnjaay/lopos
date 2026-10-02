from django.apps import AppConfig


class DashboardConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.dashboard"
    verbose_name = "Tableau de bord"

    def ready(self) -> None:
        from django.contrib import admin

        # L'accueil de l'admin est le tableau de bord du gérant, pas un
        # « Site d'administration » générique.
        admin.site.index_title = "Tableau de bord"
