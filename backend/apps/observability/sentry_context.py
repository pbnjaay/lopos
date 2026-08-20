from __future__ import annotations

import sentry_sdk


def tag_sale_scope(*, sale_id, cash_session_id, payment_method: str | None = None, offline: bool = False) -> None:
    sentry_sdk.set_tag("sale_id", str(sale_id))
    sentry_sdk.set_tag("cash_session_id", str(cash_session_id))
    if payment_method:
        sentry_sdk.set_tag("payment_method", payment_method)
    sentry_sdk.set_tag("offline", offline)


def tag_cash_session_scope(*, cash_session_id, store_id=None) -> None:
    sentry_sdk.set_tag("cash_session_id", str(cash_session_id))
    if store_id:
        sentry_sdk.set_tag("store_id", str(store_id))


def tag_sync_scope(*, sync_event_id=None, store_id=None) -> None:
    if sync_event_id:
        sentry_sdk.set_tag("sync_event_id", str(sync_event_id))
    if store_id:
        sentry_sdk.set_tag("store_id", str(store_id))
