import type { CashSession, CashSessionSummary } from "../types/api"
import { apiRequest } from "./client"

export type OpenCashSessionInput = {
  cash_register_id: string
  opening_balance: string
}

export type CloseCashSessionInput = {
  counted_cash: string
}

export function openCashSession(input: OpenCashSessionInput): Promise<CashSession> {
  return apiRequest<CashSession>("cash-sessions/open/", {
    method: "POST",
    body: input,
  })
}

export function getCashSessionSummary(id: string): Promise<CashSessionSummary> {
  return apiRequest<CashSessionSummary>(
    `cash-sessions/${encodeURIComponent(id)}/summary/`,
  )
}

export function closeCashSession(
  id: string,
  input: CloseCashSessionInput,
): Promise<CashSessionSummary> {
  return apiRequest<CashSessionSummary>(
    `cash-sessions/${encodeURIComponent(id)}/close/`,
    {
      method: "POST",
      body: input,
    },
  )
}
