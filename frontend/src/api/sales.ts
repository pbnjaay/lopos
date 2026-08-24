import type { CompleteSaleInput, SaleReceipt, SaleResponse, SaleReturn, PaymentMethod } from "../types/api"
import { apiRequest } from "./client"

export function completeSale(input: CompleteSaleInput): Promise<SaleResponse> {
  return apiRequest<SaleResponse>("sales/", {
    method: "POST",
    body: input,
  })
}

export function getSaleReceipt(id: string): Promise<SaleReceipt> {
  return apiRequest<SaleReceipt>(`sales/${encodeURIComponent(id)}/`)
}

export function createSaleReturn(input: {
  sale_id: string; cash_session_id: string; idempotency_key: string;
  payment_method: PaymentMethod;
  items: Array<{ sale_item_id: string; quantity: string; restock: boolean }>
}): Promise<SaleReturn> {
  return apiRequest<SaleReturn>("returns/", { method: "POST", body: input })
}

export function getSaleReturn(id: string): Promise<SaleReturn> {
  return apiRequest<SaleReturn>(`returns/${encodeURIComponent(id)}/`)
}
