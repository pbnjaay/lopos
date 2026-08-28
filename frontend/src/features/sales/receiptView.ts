import type { LocalSale } from "../../db/types"
import type { PaymentMethod, SaleReceipt } from "../../types/api"
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
  payment: {
    method: PaymentMethod
    receivedAmount: number | null
    changeAmount: number | null
  }
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
    payment: {
      method: receipt.payment.method,
      receivedAmount: toIntegerAmount(receipt.payment.received_amount),
      changeAmount: toIntegerAmount(receipt.payment.change_amount),
    },
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
    payment: sale.payment,
  }
}
