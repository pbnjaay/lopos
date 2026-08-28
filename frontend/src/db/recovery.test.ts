import "fake-indexeddb/auto"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { PosDatabase } from "./database"
import { repairPendingSoldQuantities } from "./recovery"
import type { LocalProduct, LocalSale } from "./types"

let database: PosDatabase

const product: LocalProduct = {
  id: "product-id",
  storeId: "store-id",
  name: "Coca",
  barcode: "123",
  sellingPrice: 500,
  serverKnownStockMilli: 20_000,
  pendingSoldQuantityMilli: 99_000,
  isActive: true,
  cachedAt: "2026-08-28T10:00:00Z",
}

function sale(id: string, status: LocalSale["status"], quantityMilli: number): LocalSale {
  return {
    id,
    serverId: status === "SYNCED" ? id : null,
    syncEventId: `event-${id}`,
    cashSessionId: "session-id",
    storeId: "store-id",
    storeName: "Boutique",
    cashRegisterId: "register-id",
    cashRegisterName: "Caisse",
    cashierId: 1,
    cashierName: "Awa",
    createdAt: "2026-08-28T10:00:00Z",
    status,
    conflictCode: null,
    conflictMessage: null,
    items: [{
      productId: product.id,
      productName: product.name,
      unitPrice: 500,
      quantityMilli,
      lineTotal: 500 * quantityMilli / 1000,
    }],
    payment: { method: "WAVE", amount: 500, receivedAmount: null, changeAmount: null },
    subtotal: 500,
    discount: 0,
    total: 500,
  }
}

beforeEach(async () => {
  database = new PosDatabase()
  await database.products.put(product)
})

afterEach(async () => {
  database.close()
  await database.delete()
})

describe("repairPendingSoldQuantities", () => {
  it("rebuilds counters from pending and conflict sales without touching sales", async () => {
    await database.localSales.bulkPut([
      sale("pending", "PENDING_SYNC", 2_000),
      sale("conflict", "CONFLICT", 1_000),
      sale("synced", "SYNCED", 5_000),
    ])

    await repairPendingSoldQuantities(database)

    const repaired = await database.products.get([product.storeId, product.id])
    expect(repaired?.pendingSoldQuantityMilli).toBe(3_000)
    expect(repaired?.pendingSoldQuantity).toBe(3)
    await expect(database.localSales.count()).resolves.toBe(3)
  })

  it("is idempotent", async () => {
    await database.localSales.put(sale("pending", "PENDING_SYNC", 2_000))

    await repairPendingSoldQuantities(database)
    await repairPendingSoldQuantities(database)

    expect((await database.products.get([product.storeId, product.id]))?.pendingSoldQuantityMilli).toBe(2_000)
  })
})
