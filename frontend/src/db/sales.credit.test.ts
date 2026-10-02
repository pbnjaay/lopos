import "fake-indexeddb/auto"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { saveCustomerBook } from "./customers"
import { PosDatabase } from "./database"
import {
  InvalidLocalPaymentError,
  createLocalSale,
  markLocalSaleConflict,
  markLocalSaleSynced,
  pendingCreditByCustomer,
} from "./sales"
import type { LocalCashSession, LocalProduct, LocalSaleCustomer } from "./types"

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
  openedAt: "2026-09-28T08:00:00Z",
  status: "OPEN",
  cachedAt: "2026-09-28T08:00:00Z",
}

const rice: LocalProduct = {
  id: "rice-id",
  storeId: "store-id",
  name: "Riz 5kg",
  barcode: null,
  sellingPrice: 5_000,
  serverKnownStock: 20,
  pendingSoldQuantity: 0,
  isActive: true,
  cachedAt: "2026-09-28T08:00:00Z",
}

const moussa: LocalSaleCustomer = { id: "moussa", name: "Moussa Fall", phone: "+221771234567" }

beforeEach(async () => {
  database = new PosDatabase()
  await database.products.put(rice)
  await saveCustomerBook(
    "store-id",
    [
      {
        id: "moussa",
        store_id: "store-id",
        name: "Moussa Fall",
        phone: "+221771234567",
        is_active: true,
        balance: "12500.00",
        last_activity_at: null,
        updated_at: "2026-09-01T00:00:00Z",
      },
    ],
    database,
  )
})

afterEach(async () => {
  database.close()
  await database.delete()
})

function sell(
  quantity: number,
  payments: Parameters<typeof createLocalSale>[0]["payments"],
  credit: Parameters<typeof createLocalSale>[0]["credit"],
) {
  return createLocalSale({ session, items: [{ productId: rice.id, quantity }], payments, credit }, database)
}

describe("createLocalSale with a credit portion", () => {
  it("records a full credit sale with no payment", async () => {
    const sale = await sell(1, [], { customer: moussa, amount: 5_000 })

    expect(sale.payments).toEqual([])
    expect(sale.creditAmount).toBe(5_000)
    expect(sale.customer).toEqual(moussa)
    expect(sale.total).toBe(5_000)
    expect((await database.products.get(["store-id", rice.id]))?.pendingSoldQuantity).toBe(1)
  })

  it("records a partial credit sale after an immediate payment", async () => {
    const sale = await sell(2, [{ method: "CASH", amount: 4_000, receivedAmount: 4_000 }], {
      customer: moussa,
      amount: 6_000,
    })

    expect(sale.payments).toEqual([
      { method: "CASH", amount: 4_000, receivedAmount: 4_000, changeAmount: 0 },
    ])
    expect(sale.creditAmount).toBe(6_000)
  })

  it("keeps ordinary sales free of credit", async () => {
    const sale = await sell(1, [{ method: "WAVE", amount: 5_000 }], undefined)

    expect(sale.creditAmount).toBe(0)
    expect(sale.customer).toBeNull()
  })

  it.each([
    ["payments + credit short of the total", [{ method: "CASH" as const, amount: 4_000, receivedAmount: 4_000 }], 5_000],
    ["credit above the total", [], 10_001],
    ["change given while putting a debt on the book", [{ method: "CASH" as const, amount: 4_000, receivedAmount: 5_000 }], 6_000],
    ["a fractional credit amount", [], 9_999.5],
  ])("rejects %s and writes nothing", async (_label, payments, amount) => {
    await expect(sell(2, payments, { customer: moussa, amount })).rejects.toBeInstanceOf(
      InvalidLocalPaymentError,
    )

    expect(await database.localSales.count()).toBe(0)
    expect((await database.products.get(["store-id", rice.id]))?.pendingSoldQuantity).toBe(0)
  })
})

describe("pending credit on the customer book", () => {
  it("adds unsynced credit per customer, including sales in conflict", async () => {
    await sell(1, [], { customer: moussa, amount: 5_000 })
    const conflicted = await sell(1, [{ method: "CASH", amount: 2_000, receivedAmount: 2_000 }], {
      customer: moussa,
      amount: 3_000,
    })
    await markLocalSaleConflict(conflicted.id, { code: "X", message: "x" }, database)
    await sell(1, [{ method: "WAVE", amount: 5_000 }], undefined)

    expect(await pendingCreditByCustomer("store-id", database)).toEqual(new Map([["moussa", 8_000]]))
  })

  it("moves the debt into the known balance once the sale is synced", async () => {
    const sale = await sell(1, [], { customer: moussa, amount: 5_000 })

    await markLocalSaleSynced(sale.id, sale.id, database)
    await markLocalSaleSynced(sale.id, sale.id, database)

    expect((await database.customers.get(["store-id", "moussa"]))?.serverBalance).toBe(17_500)
    expect(await pendingCreditByCustomer("store-id", database)).toEqual(new Map())
  })
})
