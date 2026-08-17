import pytest
from django.contrib import admin
from django.test import RequestFactory

from apps.sales.admin import PaymentAdmin, SaleAdmin, SaleItemAdmin
from apps.sales.models import Payment, Sale, SaleItem


pytestmark = pytest.mark.django_db


@pytest.mark.parametrize(
    ("model", "admin_class"),
    [(Sale, SaleAdmin), (SaleItem, SaleItemAdmin), (Payment, PaymentAdmin)],
)
def test_sales_admin_is_registered_and_read_only(model, admin_class) -> None:
    model_admin = admin_class(model, admin.site)
    request = RequestFactory().get("/admin/")

    assert model in admin.site._registry
    assert model_admin.has_add_permission(request) is False
    assert model_admin.has_change_permission(request) is False
    assert model_admin.has_delete_permission(request) is False
