"""Validation par un gérant des opérations sensibles d'un caissier (H2, M3).

Seuils (settings) : 5 000 FCFA pour une annulation ou un retour, 7 jours
après la vente pour un retour, 10 % ou 5 000 FCFA de remise.
"""

from datetime import timedelta
from decimal import Decimal
from uuid import uuid4

import pytest
from django.contrib.auth import get_user_model
from django.test import Client
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from apps.cash.models import CashSession
from apps.customers.admin import ManualLedgerEntryForm
from apps.customers.models import CustomerLedgerEntry
from apps.customers.services import record_adjustment
from apps.dashboard.services import get_manager_dashboard
from apps.sales import approvals
from apps.sales.exceptions import InvalidCancellation
from apps.sales.models import Sale
from apps.sales.services import cancel_sale, complete_sale, create_sale_return
from apps.stores.models import StoreAssignment
from apps.sync.models import ProcessedSyncEvent
from apps.tenancy.models import OrganizationMembership

from .tenancy_factories import build_commerce, throwaway_password

pytestmark = [pytest.mark.django_db, pytest.mark.explicit_tenancy]
User = get_user_model()
Role = OrganizationMembership.Role
PIN = "4821"


@pytest.fixture
def commerce():
    return build_commerce("a")


@pytest.fixture
def manager(commerce):
    user = User.objects.create_user(username="gerant-a", first_name="Awa", is_staff=True)
    membership = OrganizationMembership.objects.create(
        organization=commerce.organization, user=user, role=Role.MANAGER
    )
    membership.set_approval_pin(PIN)
    membership.save()
    StoreAssignment.objects.create(user=user, store=commerce.store)
    return user


def _big_sale(commerce, quantity=Decimal("6")) -> Sale:
    total = commerce.product.selling_price * quantity
    return complete_sale(
        cash_session=commerce.session,
        items=[{"product_id": commerce.product.pk, "quantity": quantity, "unit_price": None}],
        payments=[{"method": "CASH", "amount": total, "received_amount": total}],
    )


def _client(user) -> APIClient:
    client = APIClient()
    client.force_authenticate(user)
    return client


def _approval(commerce, manager, action, sale_id, pin=PIN):
    return _client(commerce.cashier).post(
        reverse("approval-create"),
        {
            "cash_session_id": str(commerce.session.pk),
            "action": action,
            "sale_id": str(sale_id),
            "approver_id": manager.pk,
            "pin": pin,
        },
        format="json",
    )


# --- PIN et valideurs -------------------------------------------------------


def test_the_pin_is_stored_hashed(manager) -> None:
    membership = OrganizationMembership.objects.get(user=manager)

    assert PIN not in membership.approval_pin
    assert membership.check_approval_pin(PIN)
    assert not membership.check_approval_pin("0000")


def test_approvers_are_the_owner_and_assigned_managers_with_a_pin(commerce, manager) -> None:
    owner_membership = OrganizationMembership.objects.get(user=commerce.owner)
    owner_membership.set_approval_pin("9999")
    owner_membership.save()
    unassigned = User.objects.create_user(username="gerant-ailleurs")
    OrganizationMembership.objects.create(
        organization=commerce.organization, user=unassigned, role=Role.MANAGER,
        approval_pin="x",
    )
    other = build_commerce("b")

    response = _client(commerce.cashier).get(
        reverse("approval-approvers"), {"cash_session_id": str(commerce.session.pk)}
    )

    assert response.status_code == 200
    assert {entry["id"] for entry in response.json()} == {manager.pk, commerce.owner.pk}
    assert other.owner.pk not in {entry["id"] for entry in response.json()}


def test_a_wrong_pin_is_refused_and_five_errors_suspend_the_approver(commerce, manager) -> None:
    sale = _big_sale(commerce)
    for _ in range(approvals.PIN_MAX_FAILURES):
        response = _approval(commerce, manager, "CANCEL_SALE", sale.pk, pin="0000")
        assert response.status_code == 403
        assert response.json()["code"] == "INVALID_APPROVAL_PIN"

    locked = _approval(commerce, manager, "CANCEL_SALE", sale.pk)

    assert locked.status_code == 429
    assert locked.json()["code"] == "APPROVAL_PIN_LOCKED"


def test_only_the_cashier_at_their_open_session_can_ask_for_approval(commerce, manager) -> None:
    sale = _big_sale(commerce)
    colleague = User.objects.create_user(username="collegue")
    OrganizationMembership.objects.create(
        organization=commerce.organization, user=colleague, role=Role.CASHIER
    )
    StoreAssignment.objects.create(user=colleague, store=commerce.store)

    response = _client(colleague).post(
        reverse("approval-create"),
        {
            "cash_session_id": str(commerce.session.pk),
            "action": "CANCEL_SALE",
            "sale_id": str(sale.pk),
            "approver_id": manager.pk,
            "pin": PIN,
        },
        format="json",
    )

    assert response.status_code == 403
    assert response.json()["code"] == "OPEN_CASH_SESSION_REQUIRED"


# --- Annulation ------------------------------------------------------------------


def test_a_small_cancellation_needs_only_a_reason(commerce) -> None:
    sale = _big_sale(commerce, quantity=Decimal("2"))  # 2 000 FCFA

    response = _client(commerce.cashier).post(
        reverse("sale-cancel", args=[sale.pk]), {"reason": "Mauvais article"}, format="json"
    )

    assert response.status_code == 200, response.json()
    sale.refresh_from_db()
    assert sale.status == Sale.Status.CANCELLED
    assert sale.cancellation_reason == "Mauvais article"
    assert sale.cancelled_by == commerce.cashier
    assert sale.cancelled_at is not None
    assert sale.cancellation_approved_by is None


def test_a_cancellation_without_reason_is_refused(commerce) -> None:
    sale = _big_sale(commerce, quantity=Decimal("2"))

    response = _client(commerce.cashier).post(
        reverse("sale-cancel", args=[sale.pk]), {"reason": "  "}, format="json"
    )

    assert response.status_code == 400
    sale.refresh_from_db()
    assert sale.status == Sale.Status.COMPLETED


def test_a_large_cancellation_needs_a_manager(commerce, manager) -> None:
    sale = _big_sale(commerce)  # 6 000 FCFA

    refused = _client(commerce.cashier).post(
        reverse("sale-cancel", args=[sale.pk]), {"reason": "Client parti"}, format="json"
    )
    token = _approval(commerce, manager, "CANCEL_SALE", sale.pk).json()["approval_token"]
    accepted = _client(commerce.cashier).post(
        reverse("sale-cancel", args=[sale.pk]),
        {"reason": "Client parti", "approval_token": token},
        format="json",
    )

    assert refused.status_code == 403
    assert refused.json()["code"] == "MANAGER_APPROVAL_REQUIRED"
    assert accepted.status_code == 200
    sale.refresh_from_db()
    assert sale.cancellation_approved_by == manager


def test_an_approval_only_covers_its_own_sale_and_action(commerce, manager) -> None:
    sale = _big_sale(commerce)
    other_sale = _big_sale(commerce)
    for_other_sale = _approval(commerce, manager, "CANCEL_SALE", other_sale.pk).json()
    for_a_return = _approval(commerce, manager, "SALE_RETURN", sale.pk).json()

    for token in (for_other_sale["approval_token"], for_a_return["approval_token"], "forged"):
        with pytest.raises(approvals.ApprovalRequired):
            cancel_sale(
                sale_id=sale.pk, cancelled_by=commerce.cashier, reason="x", approval_token=token
            )


def test_an_approval_expires(commerce, manager, settings) -> None:
    sale = _big_sale(commerce)
    token = _approval(commerce, manager, "CANCEL_SALE", sale.pk).json()["approval_token"]
    settings.APPROVAL_TOKEN_MAX_AGE_SECONDS = -120

    with pytest.raises(approvals.ApprovalRequired):
        cancel_sale(sale_id=sale.pk, cancelled_by=commerce.cashier, reason="x", approval_token=token)


def test_a_manager_cancels_a_large_sale_without_approval(commerce, manager) -> None:
    sale = _big_sale(commerce)

    cancel_sale(sale_id=sale.pk, cancelled_by=manager, reason="Doublon")

    sale.refresh_from_db()
    assert sale.status == Sale.Status.CANCELLED
    assert sale.cancellation_approved_by is None


def test_no_one_cancels_a_sale_of_a_closed_session(commerce) -> None:
    sale = _big_sale(commerce, quantity=Decimal("2"))
    CashSession.objects.filter(pk=commerce.session.pk).update(status=CashSession.Status.CLOSED)

    with pytest.raises(InvalidCancellation, match="clôturée"):
        cancel_sale(sale_id=sale.pk, cancelled_by=commerce.owner, reason="x")


# --- Retour ------------------------------------------------------------------------


def _return(commerce, sale, quantity, approval_token=None):
    return create_sale_return(
        original_sale=sale,
        cash_session=commerce.session,
        created_by=commerce.cashier,
        items=[{"sale_item_id": sale.items.get().pk, "quantity": quantity, "restock": True}],
        idempotency_key=uuid4(),
        payment_method="CASH",
        approval_token=approval_token,
    )


def test_a_small_recent_return_needs_no_manager(commerce) -> None:
    sale = _big_sale(commerce)

    sale_return = _return(commerce, sale, Decimal("1"))

    assert sale_return.approved_by is None


def test_a_large_return_needs_a_manager(commerce, manager) -> None:
    sale = _big_sale(commerce)

    with pytest.raises(approvals.ApprovalRequired):
        _return(commerce, sale, Decimal("5"))

    token = _approval(commerce, manager, "SALE_RETURN", sale.pk).json()["approval_token"]
    sale_return = _return(commerce, sale, Decimal("5"), approval_token=token)
    assert sale_return.approved_by == manager


def test_a_return_on_an_old_sale_needs_a_manager(commerce) -> None:
    sale = _big_sale(commerce)
    Sale.objects.filter(pk=sale.pk).update(occurred_at=timezone.now() - timedelta(days=8))
    sale.refresh_from_db()

    with pytest.raises(approvals.ApprovalRequired):
        _return(commerce, sale, Decimal("1"))


def test_return_api_reports_the_approval_requirement(commerce) -> None:
    sale = _big_sale(commerce)

    response = _client(commerce.cashier).post(
        reverse("sale-return-list"),
        {
            "sale_id": str(sale.pk),
            "cash_session_id": str(commerce.session.pk),
            "idempotency_key": str(uuid4()),
            "payment_method": "CASH",
            "items": [{"sale_item_id": str(sale.items.get().pk), "quantity": "5", "restock": True}],
        },
        format="json",
    )

    assert response.status_code == 403
    assert response.json()["code"] == "MANAGER_APPROVAL_REQUIRED"


# --- Remise (vente hors ligne) -------------------------------------------------------


def _push_discounted_sale(commerce, *, unit_price, quantity=1, approval_token=None, sale_id=None):
    sale_id = sale_id or uuid4()
    amount = (Decimal(unit_price) * quantity).quantize(Decimal("0.01"))
    payload = {
        "cash_session_id": str(commerce.session.pk),
        "items": [{
            "product_id": str(commerce.product.pk),
            "product_name": commerce.product.name,
            "unit_price": unit_price,
            "catalog_unit_price": "1000.00",
            "quantity": quantity,
        }],
        "payments": [{"method": "WAVE", "amount": str(amount)}],
    }
    if approval_token:
        payload["approval_token"] = approval_token
    event_id = uuid4()
    response = _client(commerce.cashier).post(
        reverse("sync-push"),
        {
            "terminal_id": str(uuid4()),
            "events": [{
                "event_id": str(event_id),
                "type": "SALE_COMPLETED",
                "entity_id": str(sale_id),
                "occurred_at": timezone.now().isoformat(),
                "payload": payload,
            }],
        },
        format="json",
    )
    assert response.json()["results"][0]["status"] == "SYNCED", response.json()
    return Sale.objects.get(pk=sale_id), ProcessedSyncEvent.objects.get(pk=event_id)


def test_a_small_discount_is_not_flagged(commerce) -> None:
    _, event = _push_discounted_sale(commerce, unit_price="950.00")

    assert event.unapproved_discount is False


def test_a_discount_beyond_ten_percent_without_approval_is_flagged(commerce) -> None:
    sale, event = _push_discounted_sale(commerce, unit_price="800.00")

    assert sale.status == Sale.Status.COMPLETED  # la vente a eu lieu
    assert event.unapproved_discount is True
    assert sale.discount_approved_by is None


def test_a_large_total_discount_is_flagged_even_below_ten_percent(commerce) -> None:
    # 6 % sur 100 articles : 6 000 FCFA de remise.
    _, event = _push_discounted_sale(commerce, unit_price="940.00", quantity=100)

    assert event.unapproved_discount is True


def test_an_approved_discount_is_recorded_and_not_flagged(commerce, manager) -> None:
    sale_id = uuid4()
    token = _approval(commerce, manager, "DISCOUNT", sale_id).json()["approval_token"]

    sale, event = _push_discounted_sale(
        commerce, unit_price="800.00", approval_token=token, sale_id=sale_id
    )

    assert event.unapproved_discount is False
    assert sale.discount_approved_by == manager


def test_an_approval_for_another_sale_does_not_cover_a_discount(commerce, manager) -> None:
    token = _approval(commerce, manager, "DISCOUNT", uuid4()).json()["approval_token"]

    _, event = _push_discounted_sale(commerce, unit_price="800.00", approval_token=token)

    assert event.unapproved_discount is True


def test_dashboard_alerts_on_unapproved_discounts(commerce) -> None:
    _push_discounted_sale(commerce, unit_price="800.00")

    alerts = [a for a in get_manager_dashboard().alerts if "remise non validée" in a.text]

    assert len(alerts) == 1
    assert "unapproved_discount__exact=1" in alerts[0].url


# --- Cahier : grosse réduction de dette ------------------------------------------------


def _ledger_form(commerce, *, amount, can_reduce):
    form_class = type("F", (ManualLedgerEntryForm,), {"can_reduce_large_debts": can_reduce})
    return form_class(
        data={
            "customer": commerce.customer.pk,
            "entry_type": CustomerLedgerEntry.EntryType.ADJUSTMENT,
            "amount": amount,
            "reason": "Geste commercial",
        }
    )


def test_only_the_owner_erases_a_large_debt(commerce) -> None:
    record_adjustment(
        customer=commerce.customer, amount=Decimal("20000"), reason="Reprise",
        created_by=commerce.owner,
    )

    assert not _ledger_form(commerce, amount="-5000", can_reduce=False).is_valid()
    assert _ledger_form(commerce, amount="-4999", can_reduce=False).is_valid()
    assert _ledger_form(commerce, amount="-5000", can_reduce=True).is_valid()


# --- Code PIN choisi par le gérant lui-même -------------------------------------------


def _pin_form(client, *, password, pin, confirmation=None):
    return client.post(
        reverse("admin:approval_pin"),
        {"current_password": password, "pin": pin, "pin_confirmation": confirmation or pin},
    )


def test_a_manager_sets_their_own_pin_with_their_password(commerce) -> None:
    password = throwaway_password()
    user = User.objects.create_user(username="gerant-b", password=password, is_staff=True)
    OrganizationMembership.objects.create(
        organization=commerce.organization, user=user, role=Role.MANAGER
    )
    client = Client()
    client.force_login(user)

    wrong_password = _pin_form(client, password="nope", pin="4821")
    weak = _pin_form(client, password=password, pin="1234")
    saved = _pin_form(client, password=password, pin="4821")

    assert wrong_password.status_code == 200
    assert weak.status_code == 200
    assert saved.status_code == 302
    assert OrganizationMembership.objects.get(user=user).check_approval_pin("4821")


def test_a_cashier_has_no_pin_page(commerce) -> None:
    client = Client()
    client.force_login(commerce.cashier)

    response = client.get(reverse("admin:approval_pin"))

    # Pas staff : renvoyé vers la connexion de l'admin.
    assert response.status_code == 302
    assert not OrganizationMembership.objects.get(user=commerce.cashier).approval_pin
