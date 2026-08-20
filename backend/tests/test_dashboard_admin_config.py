import pytest
from django.conf import settings
from django.contrib import admin
from django.test import RequestFactory
from django.urls import reverse

from apps.sales.admin import PaymentInline, SaleAdmin, SaleItemInline
from apps.sales.models import Sale


pytestmark = pytest.mark.django_db


def test_sidebar_navigation_groups_models_by_business_task() -> None:
    navigation = settings.UNFOLD["SIDEBAR"]["navigation"]
    titles = [str(group["title"]) for group in navigation if group["title"]]

    assert titles == ["Catalogue", "Stock", "Caisses", "Ventes", "Configuration"]
    assert settings.UNFOLD["SIDEBAR"]["show_all_applications"] is False


def test_sidebar_does_not_link_technical_models() -> None:
    navigation = settings.UNFOLD["SIDEBAR"]["navigation"]
    all_links = [
        str(item["link"])
        for group in navigation
        for item in group["items"]
    ]

    assert not any("saleitem" in link for link in all_links)
    assert not any("payment" in link for link in all_links)
    assert not any("processedsyncevent" in link for link in all_links)


def test_dashboard_callback_is_configured() -> None:
    assert (
        settings.UNFOLD["DASHBOARD_CALLBACK"]
        == "apps.dashboard.views.manager_dashboard_callback"
    )


def test_sale_admin_shows_items_and_payment_as_inlines() -> None:
    model_admin = SaleAdmin(Sale, admin.site)

    assert model_admin.inlines == (SaleItemInline, PaymentInline)


def test_sale_item_and_payment_inlines_are_read_only() -> None:
    request = RequestFactory().get("/admin/")

    for inline_class in (SaleItemInline, PaymentInline):
        inline = inline_class(Sale, admin.site)
        assert inline.has_add_permission(request) is False
        assert inline.has_change_permission(request) is False
        assert inline.has_delete_permission(request) is False


def test_admin_index_renders_manager_dashboard(client, django_user_model) -> None:
    user = django_user_model.objects.create_superuser(
        username="gerant", password="pw", email="gerant@example.com"
    )
    client.force_login(user)

    response = client.get(reverse("admin:index"))

    assert response.status_code == 200
    content = response.content.decode()
    assert "CA aujourd" in content
    assert "Panier moyen" in content
