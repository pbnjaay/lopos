import Dexie, { type EntityTable, type Table } from "dexie"

import type {
  LocalCashSession,
  LocalMetadata,
  LocalProduct,
  LocalSale,
} from "./types"

export const POS_DATABASE_NAME = "PosDatabase"
export const POS_DATABASE_VERSION = 2

export class PosDatabase extends Dexie {
  products!: Table<LocalProduct, [string, string]>
  localSales!: EntityTable<LocalSale, "id">
  cashSessions!: EntityTable<LocalCashSession, "id">
  metadata!: EntityTable<LocalMetadata, "key">

  constructor() {
    super(POS_DATABASE_NAME)

    this.version(POS_DATABASE_VERSION).stores({
      products: "[storeId+id],[storeId+barcode],storeId,barcode,name",
      localSales: "id,[status+createdAt],status,createdAt,cashSessionId",
      cashSessions: "id,cashRegisterId,status",
      metadata: "key",
    }).upgrade(async (transaction) => {
      await transaction.table("products").toCollection().modify((product) => {
        product.saleUnit = product.saleUnit ?? "UNIT"
        product.serverKnownStockMilli = product.serverKnownStock === null ? null : (product.serverKnownStock ?? 0) * 1000
        product.pendingSoldQuantityMilli = (product.pendingSoldQuantity ?? 0) * 1000
        delete product.serverKnownStock
        delete product.pendingSoldQuantity
      })
      await transaction.table("localSales").toCollection().modify((sale) => {
        sale.items = sale.items.map((item: Record<string, unknown>) => ({
          ...item,
          catalogUnitPrice: item.catalogUnitPrice ?? item.unitPrice,
          saleUnit: item.saleUnit ?? "UNIT",
          quantityMilli: Number(item.quantity ?? 0) * 1000,
        }))
      })
    })
  }
}

export const db = new PosDatabase()
