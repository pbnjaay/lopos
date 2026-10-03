from django.http import HttpResponse
from django.urls import path
from unfold.sites import UnfoldAdminSite

from apps.accounts import login_guard

from .context import get_tenant


class TenantAdminSite(UnfoldAdminSite):
    """Le back-office : `is_staff` ne suffit plus, il faut aussi appartenir
    à un commerce actif. Seul le super-utilisateur de la plateforme y entre
    sans organisation."""

    def has_permission(self, request) -> bool:
        if not super().has_permission(request):
            return False
        return request.user.is_superuser or get_tenant(request) is not None

    def get_urls(self):
        from .approval_pin import approval_pin_view

        return [
            path(
                "code-pin/",
                self.admin_view(lambda request: approval_pin_view(request, self)),
                name="approval_pin",
            ),
            *super().get_urls(),
        ]

    def login(self, request, extra_context=None):
        """Même frein que la connexion du POS (`login_guard`) : un échec
        réaffiche le formulaire (200), une réussite redirige."""
        if request.method != "POST":
            return super().login(request, extra_context)

        username = request.POST.get("username", "")
        blocked = login_guard.check(request, username)
        if blocked is not None:
            response = HttpResponse(login_guard.BLOCKED_MESSAGE, status=429)
            response["Retry-After"] = str(blocked.retry_after)
            return response

        response = super().login(request, extra_context)
        if response.status_code == 302:
            login_guard.record_success(request, username)
        else:
            login_guard.record_failure(request, username)
        return response
