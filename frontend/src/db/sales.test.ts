import "fake-indexeddb/auto"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { PosDatabase } from "./database"
import {
  InsufficientLocalStockError,
  cancelPendingLocalSale,
  countConflictLocalSales,
  countPendingLocalSales,
  countPendingLocalSalesForSession,
  createLocalSale,
  listConflictLocalSales,
  listPendingLocalSales,
  markLocalSaleConflict,
  markLocalSaleSynced,
} from "./sales"
import type { LocalCashSession, LocalProduct } from "./types"

let database: PosDatabase

const session: LocalCashSession = {
  id: "session-id",
  cashRegisterId: "register-id",
  cashRegisterName: "Caisse 01",
  storeId: "store-id",
  storeName: "Boutique Centrale",
  cashierId: 7,
  cashierName: "Awa",
  openingBalance: 15_000,
  openedAt: "2026-08-17T08:00:00Z",
  status: "OPEN",
  cachedAt: "2026-08-17T08:00:00Z",
}

const coca: LocalProduct = {
  id: "coca-id",
  storeId: "store-id",
  name: "Coca 50cl",
  barcode: "123456",
  sellingPrice: 500,
  serverKnownStock: 20,
  pendingSoldQuantity: 0,
  isActive: true,
  cachedAt: "2026-08-17T08:00:00Z",
}

beforeEach(async () => {
  database = new PosDatabase()
  await database.products.put(coca)
})

afterEach(async () => {
  database.close()
  await database.delete()
})

describe("createLocalSale", () => {
  it("creates a PENDING_SYNC sale with a permanent UUID", async () => {
    const sale = await createLocalSale(
      {
        session,
        items: [{ productId: coca.id, quantity: 2 }],
        payments: [{ method: "CASH", amount: 1_000, receivedAmount: 2_000 }],
      },
      database,
    )

    expect(sale.status).toBe("PENDING_SYNC")
    expect(sale.serverId).toBeNull()
    expect(sale.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(sale.items).toEqual([
      {
        productId: coca.id,
        productName: "Coca 50cl",
        unitPrice: 500,
        quantity: 2,
        lineTotal: 1_000,
      },
    ])
    expect(sale.payments).toEqual([
      {
        method: "CASH",
        amount: 1_000,
        receivedAmount: 2_000,
        changeAmount: 1_000,
      },
    ])
    expect(sale.total).toBe(1_000)
    expect(sale.syncEventId).toMatch(/^[0-9a-f-]{36}$/)
    expect(sale.syncEventId).not.toBe(sale.id)

    await expect(database.localSales.get(sale.id)).resolves.toEqual(sale)
  })

  it("decrements local stock atomically with the sale", async () => {
    await createLocalSale(
      {
        session,
        items: [{ productId: coca.id, quantity: 2 }],
        payments: [{ method: "CASH", amount: 1_000, receivedAmount: 2_000 }],
      },
      database,
    )

    const afterFirstSale = await database.products.get([coca.storeId, coca.id])
    expect(afterFirstSale?.pendingSoldQuantity).toBe(2)

    await createLocalSale(
      {
        session,
        items: [{ productId: coca.id, quantity: 5 }],
        payments: [{ method: "WAVE", amount: 2_500 }],
      },
      database,
    )

    const afterSecondSale = await database.products.get([coca.storeId, coca.id])
    expect(afterSecondSale?.pendingSoldQuantity).toBe(7)
    expect(20 - afterSecondSale!.pendingSoldQuantity).toBe(13)
  })

  it("rejects a sale that exceeds the known available local stock", async () => {
    await database.products.update([coca.storeId, coca.id], { pendingSoldQuantity: 18 })

    await expect(
      createLocalSale(
        {
          session,
          items: [{ productId: coca.id, quantity: 3 }],
          payments: [{ method: "CASH", amount: 1_500, receivedAmount: 3_000 }],
        },
        database,
      ),
    ).rejects.toBeInstanceOf(InsufficientLocalStockError)

    const product = await database.products.get([coca.storeId, coca.id])
    expect(product?.pendingSoldQuantity).toBe(18)
    await expect(database.localSales.count()).resolves.toBe(0)
  })

  it("creates no sale and leaves stock untouched when any item in the cart is invalid", async () => {
    await expect(
      createLocalSale(
        {
          session,
          items: [
            { productId: coca.id, quantity: 1 },
            { productId: "unknown-product", quantity: 1 },
          ],
          payments: [{ method: "CASH", amount: 1_000, receivedAmount: 1_000 }],
        },
        database,
      ),
    ).rejects.toThrow("Produit introuvable dans le catalogue local")

    const product = await database.products.get([coca.storeId, coca.id])
    expect(product?.pendingSoldQuantity).toBe(0)
    await expect(database.localSales.count()).resolves.toBe(0)
  })

  it("accepts a split payment across several methods, summing to the total", async () => {
    const sale = await createLocalSale(
      {
        session,
        items: [{ productId: coca.id, quantity: 3 }],
        payments: [
          { method: "WAVE", amount: 1_000 },
          { method: "CASH", amount: 500, receivedAmount: 500 },
        ],
      },
      database,
    )

    expect(sale.total).toBe(1_500)
    expect(sale.payments).toEqual([
      { method: "WAVE", amount: 1_000, receivedAmount: null, changeAmount: null },
      { method: "CASH", amount: 500, receivedAmount: 500, changeAmount: 0 },
    ])
  })

  it("rejects payments that don't sum to the total", async () => {
    await expect(
      createLocalSale(
        {
          session,
          items: [{ productId: coca.id, quantity: 2 }],
          payments: [{ method: "WAVE", amount: 500 }],
        },
        database,
      ),
    ).rejects.toThrow("La somme des paiements ne correspond pas au total de la vente.")
    await expect(database.localSales.count()).resolves.toBe(0)
  })
})

describe("pending sale queue", () => {
  it("counts and lists sales awaiting sync, oldest first", async () => {
    const first = await createLocalSale(
      {
        session,
        items: [{ productId: coca.id, quantity: 1 }],
        payments: [{ method: "CASH", amount: 500, receivedAmount: 500 }],
      },
      database,
    )
    const second = await createLocalSale(
      {
        session,
        items: [{ productId: coca.id, quantity: 1 }],
        payments: [{ method: "ORANGE_MONEY", amount: 500 }],
      },
      database,
    )

    await expect(countPendingLocalSales(database)).resolves.toBe(2)
    const pending = await listPendingLocalSales(database)
    expect(pending.map((sale) => sale.id)).toEqual([first.id, second.id])
  })

  it("scopes the pending count to a single cash session", async () => {
    const otherSession: LocalCashSession = { ...session, id: "other-session-id" }
    await createLocalSale(
      {
        session,
        items: [{ productId: coca.id, quantity: 1 }],
        payments: [{ method: "CASH", amount: 500, receivedAmount: 500 }],
      },
      database,
    )
    await createLocalSale(
      {
        session: otherSession,
        items: [{ productId: coca.id, quantity: 1 }],
        payments: [{ method: "WAVE", amount: 500 }],
      },
      database,
    )

    await expect(countPendingLocalSalesForSession(session.id, database)).resolves.toBe(1)
    await expect(countPendingLocalSalesForSession(otherSession.id, database)).resolves.toBe(1)
    await expect(countPendingLocalSalesForSession("no-such-session", database)).resolves.toBe(0)
  })
})

describe("sync status transitions", () => {
  it("marks a sale SYNCED with its server id and clears any prior conflict", async () => {
    const sale = await createLocalSale(
      {
        session,
        items: [{ productId: coca.id, quantity: 1 }],
        payments: [{ method: "CASH", amount: 500, receivedAmount: 500 }],
      },
      database,
    )
    await markLocalSaleConflict(sale.id, { code: "X", message: "y" }, database)

    await markLocalSaleSynced(sale.id, sale.id, database)

    const updated = await database.localSales.get(sale.id)
    expect(updated?.status).toBe("SYNCED")
    expect(updated?.serverId).toBe(sale.id)
    expect(updated?.conflictCode).toBeNull()
    expect(updated?.conflictMessage).toBeNull()
    const product = await database.products.get([coca.storeId, coca.id])
    expect(product?.pendingSoldQuantityMilli).toBe(0)
    expect(product?.pendingSoldQuantity).toBe(0)
    await expect(countPendingLocalSales(database)).resolves.toBe(0)
  })

  it("releases the local stock effect exactly once after an idempotent sync result", async () => {
    const sale = await createLocalSale(
      {
        session,
        items: [{ productId: coca.id, quantity: 2 }],
        payments: [{ method: "WAVE", amount: 1_000 }],
      },
      database,
    )

    await markLocalSaleSynced(sale.id, sale.id, database)
    await markLocalSaleSynced(sale.id, sale.id, database)

    const product = await database.products.get([coca.storeId, coca.id])
    expect(product?.pendingSoldQuantityMilli).toBe(0)
    expect(product?.pendingSoldQuantity).toBe(0)
  })

  it("marks a sale CONFLICT with the server's code and message, removing it from the pending queue", async () => {
    const sale = await createLocalSale(
      {
        session,
        items: [{ productId: coca.id, quantity: 1 }],
        payments: [{ method: "CASH", amount: 500, receivedAmount: 500 }],
      },
      database,
    )

    await markLocalSaleConflict(
      sale.id,
      { code: "CASH_SESSION_CLOSED", message: "La session de caisse est fermée." },
      database,
    )

    const updated = await database.localSales.get(sale.id)
    expect(updated?.status).toBe("CONFLICT")
    expect(updated?.conflictCode).toBe("CASH_SESSION_CLOSED")
    expect(updated?.conflictMessage).toBe("La session de caisse est fermée.")
    await expect(countPendingLocalSales(database)).resolves.toBe(0)
    await expect(countConflictLocalSales(database)).resolves.toBe(1)
    const conflicts = await listConflictLocalSales(database)
    expect(conflicts.map((item) => item.id)).toEqual([sale.id])
  })
})

describe("cancelPendingLocalSale", () => {
  it("deletes a PENDING_SYNC sale and releases its local stock effect", async () => {
    const sale = await createLocalSale(
      {
        session,
        items: [{ productId: coca.id, quantity: 2 }],
        payments: [{ method: "CASH", amount: 1_000, receivedAmount: 1_000 }],
      },
      database,
    )

    await expect(cancelPendingLocalSale(sale.id, database)).resolves.toBe(true)

    await expect(database.localSales.get(sale.id)).resolves.toBeUndefined()
    const product = await database.products.get([coca.storeId, coca.id])
    expect(product?.pendingSoldQuantityMilli).toBe(0)
    expect(product?.pendingSoldQuantity).toBe(0)
    await expect(countPendingLocalSales(database)).resolves.toBe(0)
  })

  it("does nothing and returns false once the sale has already synced", async () => {
    const sale = await createLocalSale(
      {
        session,
        items: [{ productId: coca.id, quantity: 1 }],
        payments: [{ method: "WAVE", amount: 500 }],
      },
      database,
    )
    await markLocalSaleSynced(sale.id, sale.id, database)

    await expect(cancelPendingLocalSale(sale.id, database)).resolves.toBe(false)

    const stillThere = await database.localSales.get(sale.id)
    expect(stillThere?.status).toBe("SYNCED")
  })

  it("returns false for a sale that doesn't exist locally", async () => {
    await expect(cancelPendingLocalSale("unknown-id", database)).resolves.toBe(false)
  })
})
