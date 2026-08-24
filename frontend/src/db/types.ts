import type { PaymentMethod } from "../types/api"

export type LocalProduct = {
  id: string
  storeId: string
  name: string
  barcode: string | null
  sellingPrice: number
  saleUnit?: "UNIT" | "KG"
  serverKnownStockMilli?: number | null
  pendingSoldQuantityMilli?: number
  serverKnownStock?: number | null
  pendingSoldQuantity?: number
  isActive: boolean
  updatedAt?: string
  cachedAt: string
}

export type LocalCashSession = {
  id: string
  cashRegisterId: string
  cashRegisterName: string
  storeId: string
  storeName?: string
  cashierId: number
  cashierName: string
  openingBalance: number
  openedAt: string
  status: "OPEN" | "CLOSED"
  cachedAt: string
}

export type LocalSaleStatus = "PENDING_SYNC" | "SYNCED" | "CONFLICT"

export type LocalSaleItem = {
  productId: string
  productName: string
  unitPrice: number
  catalogUnitPrice?: number
  saleUnit?: "UNIT" | "KG"
  quantityMilli?: number
  quantity?: number
  lineTotal: number
}

export type LocalPayment = {
  method: PaymentMethod
  amount: number
  receivedAmount: number | null
  changeAmount: number | null
}

export type LocalSale = {
  id: string
  serverId: string | null
  /** Sync message identity, distinct from `id`; never regenerated on retry so server idempotency holds. */
  syncEventId: string
  cashSessionId: string
  storeId: string
  storeName: string
  cashRegisterId: string
  cashRegisterName: string
  cashierId: number
  cashierName: string
  /** Horodatage produit par le terminal, pas une date de réception serveur. */
  createdAt: string
  status: LocalSaleStatus
  /** Set only when status is CONFLICT, from the server's { code, message }. */
  conflictCode: string | null
  conflictMessage: string | null
  items: LocalSaleItem[]
  payment: LocalPayment
  subtotal: number
  discount: number
  total: number
}

export type LocalMetadata = {
  key: string
  value: unknown
  updatedAt: string
}
