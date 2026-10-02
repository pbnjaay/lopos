from django.http import HttpRequest, JsonResponse
from django.views.decorators.http import require_GET


@require_GET
def healthz(request: HttpRequest) -> JsonResponse:
    """Sonde de vie de l'hébergeur : ni base, ni session, ni redirection
    HTTPS (voir SECURE_REDIRECT_EXEMPT). Ne dit rien de l'application."""
    return JsonResponse({"status": "ok"})
