from django.http import HttpRequest

from .services import get_manager_dashboard


def manager_dashboard_callback(request: HttpRequest, context: dict) -> dict:
    context["dashboard"] = get_manager_dashboard()
    return context
