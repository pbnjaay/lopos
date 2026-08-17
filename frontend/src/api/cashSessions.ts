import type { CashSession } from "../types/api"
import { apiRequest } from "./client"

export type OpenCashSessionInput = {
  cash_register_id: string
  opening_balance: string
}

export function openCashSession(input: OpenCashSessionInput): Promise<CashSession> {
  return apiRequest<CashSession>("cash-sessions/open/", {
    method: "POST",
    body: input,
  })
}
