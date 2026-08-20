import { capture } from "./posthog"
import type { PaymentMethod } from "../types/api"

export function trackCheckoutOpened(props: { cart_items_count: number; cart_total: number }) {
  capture("checkout_opened", props)
}

export function trackPaymentMethodSelected(props: { method: PaymentMethod }) {
  capture("payment_method_selected", props)
}

export function trackSaleCompleted(props: {
  sale_id: string
  store_id: string | null
  cash_register_id: string | null
  cash_session_id: string | null
  payment_method: PaymentMethod
  items_count: number
  total_amount: number
  offline: boolean
}) {
  capture("sale_completed", props)
}

export function trackSaleFailed(props: {
  error_code: string
  payment_method: PaymentMethod | null
  offline: boolean
}) {
  capture("sale_failed", props)
}

export function trackCashSessionOpened(props: {
  cash_session_id: string
  store_id: string | null
  cash_register_id: string
}) {
  capture("cash_session_opened", props)
}

export function trackCashSessionClosed(props: {
  cash_session_id: string
  store_id: string | null
  cash_register_id: string
  sales_count: number
  gross_sales: number
  cash_difference: number | null
}) {
  capture("cash_session_closed", props)
}

export function trackSyncStarted(props: { pending_count: number }) {
  capture("sync_started", props)
}

export function trackSyncCompleted(props: {
  pending_count: number
  processed_count: number
  conflict_count: number
  duration_ms: number
}) {
  capture("sync_completed", props)
}

export function trackSyncFailed(props: { pending_count: number }) {
  capture("sync_failed", props)
}

export function trackSyncConflict(props: { conflict_count: number }) {
  capture("sync_conflict", props)
}
