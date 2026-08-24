import type { PaymentMethod } from "../types/api"
import { apiRequest } from "./client"

export type SyncEventPayload = {
  cash_session_id: string
  items: Array<{
    product_id: string
    product_name: string
    unit_price: string
    catalog_unit_price?: string
    quantity: string
  }>
  payment: {
    method: PaymentMethod
    received_amount?: string
  }
}

export type SyncEvent = {
  event_id: string
  type: "SALE_COMPLETED"
  entity_id: string
  occurred_at: string
  payload: SyncEventPayload
}

export type SyncResultStatus = "SYNCED" | "ALREADY_PROCESSED" | "CONFLICT" | "REJECTED"

export type SyncResult = {
  event_id: string
  status: SyncResultStatus
  entity_id?: string
  code?: string
  message?: string
}

export type SyncPushResponse = {
  results: SyncResult[]
}

export function pushSyncEvents(
  terminalId: string,
  events: SyncEvent[],
): Promise<SyncPushResponse> {
  return apiRequest<SyncPushResponse>("sync/push/", {
    method: "POST",
    body: { terminal_id: terminalId, events },
  })
}
