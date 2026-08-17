import type { PaymentMethod } from "../types/api"

export type LocalProduct = {
  id: string
  storeId: string
  name: string
  barcode: string | null
  sellingPrice: number
  serverKnownStock: number | null
  pendingSoldQuantity: number
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

export type LocalSaleStatus = "PENDING_SYNC" | "SYNCED" | "SYNC_FAILED"

export type LocalSaleItem = {
  productId: string
  productName: string
  unitPrice: number
  quantity: number
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
