import type { CompleteSaleInput, SaleReceipt, SaleResponse } from "../types/api"
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
