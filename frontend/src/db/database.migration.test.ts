import "fake-indexeddb/auto"

import Dexie from "dexie"
import { afterEach, describe, expect, it } from "vitest"

import { POS_DATABASE_NAME, POS_DATABASE_VERSION, PosDatabase } from "./database"

afterEach(async () => {
  await Dexie.delete(POS_DATABASE_NAME)
})

describe("PosDatabase migrations", () => {
  it("upgrades a v1 database in place without losing a pending sale", async () => {
    const legacy = new Dexie(POS_DATABASE_NAME)
    legacy.version(1).stores({
      products: "[storeId+id],[storeId+barcode],storeId,barcode,name",
      localSales: "id,[status+createdAt],status,createdAt,cashSessionId",
      cashSessions: "id,cashRegisterId,status",
      metadata: "key",
    })
    await legacy.open()
    await legacy.table("products").put({
      id: "product-id",
      storeId: "store-id",
      name: "Banane",
      barcode: null,
      sellingPrice: 1_000,
      serverKnownStock: 12,
      pendingSoldQuantity: 0.3,
      isActive: true,
      cachedAt: "2026-08-28T10:00:00Z",
    })
    await legacy.table("localSales").put({
      id: "sale-id",
      status: "PENDING_SYNC",
      createdAt: "2026-08-28T10:00:00Z",
      items: [{
        productId: "product-id",
        productName: "Banane",
        unitPrice: 1_000,
        quantity: 0.3,
        lineTotal: 300,
      }],
    })
    legacy.close()

    const upgraded = new PosDatabase()
    await upgraded.open()

    expect(upgraded.verno).toBe(POS_DATABASE_VERSION)
    expect(await upgraded.localSales.count()).toBe(1)
    expect((await upgraded.localSales.get("sale-id"))?.items[0]).toMatchObject({
      catalogUnitPrice: 1_000,
      saleUnit: "UNIT",
      quantityMilli: 300,
    })
    expect(await upgraded.products.get(["store-id", "product-id"])).toMatchObject({
      saleUnit: "UNIT",
      serverKnownStockMilli: 12_000,
      pendingSoldQuantityMilli: 300,
    })
    upgraded.close()
  })
})
