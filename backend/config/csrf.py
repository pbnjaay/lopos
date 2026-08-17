from django.http import JsonResponse


def csrf_failure(request, reason="") -> JsonResponse:
    return JsonResponse(
        {
            "code": "CSRF_FAILED",
            "message": "Échec de la vérification CSRF.",
        },
        status=403,
    )
