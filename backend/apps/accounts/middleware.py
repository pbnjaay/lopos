from django.middleware.csrf import get_token


class ExposeCsrfTokenMiddleware:
    """Mirrors the CSRF token onto a response header.

    Cross-domain deployments (Vercel frontend + Railway backend) can't read
    the `csrftoken` cookie via `document.cookie` — it belongs to a different
    registrable domain, which no CORS/SameSite setting changes. The frontend
    instead caches this header value in memory and resends it as
    `X-CSRFToken`, so Django's double-submit check still works without the
    browser ever needing to read the cookie via JS.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        response["X-CSRFToken"] = get_token(request)
        return response
