from django.contrib import admin
from django.contrib.admin import sites
from unfold.apps import DefaultAppConfig


class TenantUnfoldConfig(DefaultAppConfig):
    """Remplace le site d'admin d'Unfold par `TenantAdminSite`, avant que
    l'autodiscover de `django.contrib.admin` n'y enregistre les modèles."""

    default = False

    def ready(self) -> None:
        from .admin_site import TenantAdminSite

        site = TenantAdminSite()
        admin.site = site
        sites.site = site
