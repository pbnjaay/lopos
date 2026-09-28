import type { LocalSale } from "../../db/types"
import type { PaymentMethod, SaleCustomer, SaleReceipt } from "../../types/api"
import { backendQuantityToMilli } from "../../utils/quantity"

export type ReceiptView = {
  id: string
  /** True for a sale not yet confirmed by the server; the id is a client UUID, not a server reference. */
  isPendingSync: boolean
  storeName: string
  cashRegisterName: string
  cashierName: string
  createdAt: string
  items: Array<{
    productId: string
    productName: string
    unitPrice: number
    saleUnit: "UNIT" | "KG"
    quantityMilli: number
    returnedQuantityMilli: number
    lineTotal: number
  }>
  total: number
  returnedTotal: number
  netTotal: number
  // Un seul élément pour un paiement classique, plusieurs pour un paiement
  // mixte.
  payments: Array<{
    method: PaymentMethod
    amount: number
    receivedAmount: number | null
    changeAmount: number | null
  }>
  /** Part non encaissée, mise au cahier de `customer` (0 sinon). */
  creditAmount: number
  customer: SaleCustomer | null
}

function toIntegerAmount(value: string | null): number | null {
  return value === null ? null : Math.round(Number(value))
}

export function receiptViewFromApiReceipt(receipt: SaleReceipt): ReceiptView {
  const total = Math.round(Number(receipt.total))
  const returnedTotal = Math.round(Number(receipt.returned_total ?? 0))
  return {
    id: receipt.id,
    isPendingSync: false,
    storeName: receipt.store.name,
    cashRegisterName: receipt.cash_register.name,
    cashierName: receipt.cashier.username,
    createdAt: receipt.created_at,
    items: receipt.items.map((item) => ({
      productId: item.product_id,
      productName: item.product_name,
      unitPrice: Math.round(Number(item.unit_price)),
      saleUnit: item.sale_unit ?? "UNIT",
      quantityMilli: backendQuantityToMilli(item.quantity),
      returnedQuantityMilli: backendQuantityToMilli(item.quantity_returned ?? "0.000"),
      lineTotal: Math.round(Number(item.line_total)),
    })),
    total,
    returnedTotal,
    netTotal: receipt.net_total === undefined
      ? total - returnedTotal
      : Math.round(Number(receipt.net_total)),
    payments: receipt.payments.map((payment) => ({
      method: payment.method,
      amount: Math.round(Number(payment.amount)),
      receivedAmount: toIntegerAmount(payment.received_amount),
      changeAmount: toIntegerAmount(payment.change_amount),
    })),
    creditAmount: Math.round(Number(receipt.credit_amount ?? 0)),
    customer: receipt.customer ?? null,
  }
}

export function receiptViewFromLocalSale(sale: LocalSale): ReceiptView {
  return {
    id: sale.id,
    isPendingSync: sale.status === "PENDING_SYNC",
    storeName: sale.storeName,
    cashRegisterName: sale.cashRegisterName,
    cashierName: sale.cashierName,
    createdAt: sale.createdAt,
    items: sale.items.map((item) => ({
      productId: item.productId, productName: item.productName,
      unitPrice: item.unitPrice, saleUnit: item.saleUnit ?? "UNIT",
      quantityMilli: item.quantityMilli ?? (item.quantity ?? 0) * 1000,
      returnedQuantityMilli: 0,
      lineTotal: item.lineTotal,
    })),
    total: sale.total,
    returnedTotal: 0,
    netTotal: sale.total,
    payments: sale.payments,
    creditAmount: sale.creditAmount ?? 0,
    customer: sale.customer ?? null,
  }
}

/** Montant réellement encaissé maintenant : le total moins la part mise au cahier. */
export function paidNowAmount(receipt: Pick<ReceiptView, "payments">): number {
  return receipt.payments.reduce((sum, payment) => sum + payment.amount, 0)
}
