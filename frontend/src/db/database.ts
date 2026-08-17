import Dexie, { type EntityTable, type Table } from "dexie"

import type {
  LocalCashSession,
  LocalMetadata,
  LocalProduct,
  LocalSale,
} from "./types"

export const POS_DATABASE_NAME = "PosDatabase"
export const POS_DATABASE_VERSION = 1

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
    })
  }
}

export const db = new PosDatabase()
