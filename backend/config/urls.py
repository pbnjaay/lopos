from django.contrib import admin
from django.urls import include, path
from django.views.generic import RedirectView


urlpatterns = [
    # Ce backend n'a pas de site public : la racine n'a rien à afficher elle-
    # même, elle renvoie vers le back-office plutôt que de rendre un 404.
    path("", RedirectView.as_view(url="/admin/", permanent=False)),
    path("admin/", admin.site.urls),
    path("api/v1/", include("config.api_urls")),
]
