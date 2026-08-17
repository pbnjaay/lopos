import type { CompleteSaleInput, SaleResponse } from "../types/api"
import { apiRequest } from "./client"

export function completeSale(input: CompleteSaleInput): Promise<SaleResponse> {
  return apiRequest<SaleResponse>("sales/", {
    method: "POST",
    body: input,
  })
}
