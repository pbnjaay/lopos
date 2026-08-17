import pytest
from django.contrib import admin
from django.test import RequestFactory

from apps.cash.admin import CashSessionAdmin
from apps.cash.models import CashSession


pytestmark = pytest.mark.django_db


def test_cash_session_admin_is_read_only() -> None:
    model_admin = CashSessionAdmin(CashSession, admin.site)
    request = RequestFactory().get("/admin/")

    assert CashSession in admin.site._registry
    assert model_admin.has_add_permission(request) is False
    assert model_admin.has_change_permission(request) is False
    assert model_admin.has_delete_permission(request) is False
