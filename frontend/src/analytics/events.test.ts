// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest"

vi.mock("./posthog", () => ({ capture: vi.fn() }))

import { capture } from "./posthog"
import {
  trackCashSessionClosed,
  trackCashSessionOpened,
  trackCheckoutOpened,
  trackPaymentMethodSelected,
  trackSaleCompleted,
  trackSaleFailed,
  trackSyncCompleted,
  trackSyncConflict,
  trackSyncFailed,
  trackSyncStarted,
} from "./events"

describe("analytics events", () => {
  it("tracks checkout_opened", () => {
    trackCheckoutOpened({ cart_items_count: 3, cart_total: 4500 })
    expect(capture).toHaveBeenCalledWith("checkout_opened", {
      cart_items_count: 3,
      cart_total: 4500,
    })
  })

  it("tracks payment_method_selected", () => {
    trackPaymentMethodSelected({ method: "WAVE" })
    expect(capture).toHaveBeenCalledWith("payment_method_selected", { method: "WAVE" })
  })

  it("tracks sale_completed with offline flag", () => {
    trackSaleCompleted({
      sale_id: "sale-1",
      store_id: "store-1",
      cash_register_id: "reg-1",
      cash_session_id: "session-1",
      payment_method: "CASH",
      items_count: 2,
      total_amount: 1000,
      offline: true,
    })
    expect(capture).toHaveBeenCalledWith(
      "sale_completed",
      expect.objectContaining({ sale_id: "sale-1", offline: true }),
    )
  })

  it("tracks sale_failed", () => {
    trackSaleFailed({ error_code: "INSUFFICIENT_STOCK", payment_method: "CASH", offline: false })
    expect(capture).toHaveBeenCalledWith("sale_failed", {
      error_code: "INSUFFICIENT_STOCK",
      payment_method: "CASH",
      offline: false,
    })
  })

  it("tracks cash session opened and closed", () => {
    trackCashSessionOpened({ cash_session_id: "s1", store_id: "store-1", cash_register_id: "r1" })
    expect(capture).toHaveBeenCalledWith("cash_session_opened", {
      cash_session_id: "s1",
      store_id: "store-1",
      cash_register_id: "r1",
    })

    trackCashSessionClosed({
      cash_session_id: "s1",
      store_id: null,
      cash_register_id: "r1",
      sales_count: 5,
      gross_sales: 10000,
      cash_difference: 0,
    })
    expect(capture).toHaveBeenCalledWith(
      "cash_session_closed",
      expect.objectContaining({ sales_count: 5 }),
    )
  })

  it("tracks sync lifecycle events", () => {
    trackSyncStarted({ pending_count: 2 })
    expect(capture).toHaveBeenCalledWith("sync_started", { pending_count: 2 })

    trackSyncCompleted({
      pending_count: 2,
      processed_count: 2,
      conflict_count: 0,
      duration_ms: 120,
    })
    expect(capture).toHaveBeenCalledWith(
      "sync_completed",
      expect.objectContaining({ processed_count: 2 }),
    )

    trackSyncFailed({ pending_count: 2 })
    expect(capture).toHaveBeenCalledWith("sync_failed", { pending_count: 2 })

    trackSyncConflict({ conflict_count: 1 })
    expect(capture).toHaveBeenCalledWith("sync_conflict", { conflict_count: 1 })
  })
})
