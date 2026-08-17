import type { LocalSale } from "../../db/types"
import type { PaymentMethod, SaleReceipt, SaleResponse } from "../../types/api"

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
    quantity: number
    lineTotal: number
  }>
  total: number
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
      quantity: item.quantity,
      lineTotal: Math.round(Number(item.line_total)),
    })),
    total: Math.round(Number(receipt.total)),
    payment: {
      method: receipt.payment.method,
      receivedAmount: toIntegerAmount(receipt.payment.received_amount),
      changeAmount: toIntegerAmount(receipt.payment.change_amount),
    },
  }
}

export function receiptViewFromApiSale(
  sale: SaleResponse,
  context: { storeName: string; cashRegisterName: string; cashierName: string },
): ReceiptView {
  return {
    id: sale.id,
    isPendingSync: false,
    storeName: context.storeName,
    cashRegisterName: context.cashRegisterName,
    cashierName: context.cashierName,
    createdAt: sale.created_at,
    items: sale.items.map((item) => ({
      productId: item.product_id,
      productName: item.product_name,
      unitPrice: Math.round(Number(item.unit_price)),
      quantity: item.quantity,
      lineTotal: Math.round(Number(item.line_total)),
    })),
    total: Math.round(Number(sale.total)),
    payment: {
      method: sale.payment.method,
      receivedAmount: toIntegerAmount(sale.payment.received_amount),
      changeAmount: toIntegerAmount(sale.payment.change_amount),
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
    items: sale.items,
    total: sale.total,
    payment: sale.payment,
  }
}
