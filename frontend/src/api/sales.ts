import type { CompleteSaleInput, PaginatedSales, SaleReceipt, SaleResponse, SaleReturn, PaymentMethod } from "../types/api"
import { apiRequest, buildApiUrl } from "./client"

export function completeSale(input: CompleteSaleInput): Promise<SaleResponse> {
  return apiRequest<SaleResponse>("sales/", {
    method: "POST",
    body: input,
  })
}

export function listSales(input: {
  cashSessionId: string
  search?: string
  dateFrom?: string
  dateTo?: string
  paymentMethod?: PaymentMethod | ""
  page?: number
  pageSize?: number
}): Promise<PaginatedSales> {
  return apiRequest<PaginatedSales>(buildApiUrl("sales/", {
    cash_session_id: input.cashSessionId,
    search: input.search || undefined,
    date_from: input.dateFrom || undefined,
    date_to: input.dateTo || undefined,
    payment_method: input.paymentMethod || undefined,
    page: input.page,
    page_size: input.pageSize,
  }))
}

export function getSaleReceipt(id: string, cashSessionId?: string): Promise<SaleReceipt> {
  return apiRequest<SaleReceipt>(buildApiUrl(`sales/${encodeURIComponent(id)}/`, {
    cash_session_id: cashSessionId,
  }))
}

export function createSaleReturn(input: {
  sale_id: string; cash_session_id: string; idempotency_key: string;
  payment_method: PaymentMethod;
  items: Array<{ sale_item_id: string; quantity: string; restock: boolean }>
}): Promise<SaleReturn> {
  return apiRequest<SaleReturn>("returns/", { method: "POST", body: input })
}

export function getSaleReturn(id: string, cashSessionId?: string): Promise<SaleReturn> {
  return apiRequest<SaleReturn>(buildApiUrl(`returns/${encodeURIComponent(id)}/`, {
    cash_session_id: cashSessionId,
  }))
}
