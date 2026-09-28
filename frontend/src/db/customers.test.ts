import "fake-indexeddb/auto"

import { afterEach, describe, expect, it } from "vitest"

import type { Customer } from "../types/api"
import {
  customerBookMetadataKey,
  getCustomerBookMetadata,
  saveCustomerBook,
  searchLocalCustomers,
  upsertLocalCustomer,
} from "./customers"
import { PosDatabase } from "./database"

function customer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: "moussa",
    store_id: "store-id",
    name: "Moussa Fall",
    phone: "+221771234567",
    is_active: true,
    balance: "18500.00",
    last_activity_at: "2026-09-27T10:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    ...overrides,
  }
}

const book = [
  customer(),
  customer({ id: "aissatou", name: "Aïssatou Diop", phone: "+221760001122", balance: "0.00" }),
  customer({ id: "voisine", name: "La voisine", phone: null, balance: "2500.00" }),
  customer({ id: "ancien", name: "Moussa Ndiaye", phone: "+221780000000", is_active: false }),
]

const databases: PosDatabase[] = []

function openDatabase(): PosDatabase {
  const database = new PosDatabase()
  databases.push(database)
  return database
}

afterEach(async () => {
  await Promise.all(
    databases.map(async (database) => {
      database.close()
      await database.delete()
    }),
  )
  databases.length = 0
})

describe("customer book cache", () => {
  it("stores the snapshot with integer balances and marks the book ready", async () => {
    const database = openDatabase()

    await saveCustomerBook("store-id", book, database)

    expect(await database.customers.get(["store-id", "moussa"])).toMatchObject({
      name: "Moussa Fall",
      phone: "+221771234567",
      serverBalance: 18_500,
      isActive: true,
    })
    expect(await getCustomerBookMetadata("store-id", database)).toMatchObject({
      storeId: "store-id",
      customerCount: 4,
    })
  })

  it("replaces the previous snapshot of the same store only", async () => {
    const database = openDatabase()
    await saveCustomerBook("store-id", book, database)
    await saveCustomerBook("other-store", [customer({ id: "x", store_id: "other-store" })], database)

    await saveCustomerBook("store-id", [customer({ balance: "3000.00" })], database)

    expect(await database.customers.where("storeId").equals("store-id").count()).toBe(1)
    expect(await database.customers.get(["store-id", "moussa"])).toMatchObject({ serverBalance: 3_000 })
    expect(await database.customers.where("storeId").equals("other-store").count()).toBe(1)
  })

  it("is not ready before the first snapshot", async () => {
    expect(await getCustomerBookMetadata("store-id", openDatabase())).toBeNull()
  })

  it("keeps the book ready after adding a freshly created customer", async () => {
    const database = openDatabase()
    await saveCustomerBook("store-id", book, database)

    await upsertLocalCustomer(customer({ id: "nouveau", name: "Awa", balance: "0.00" }), database)
    await upsertLocalCustomer(customer({ balance: "1000.00" }), database)

    expect(await getCustomerBookMetadata("store-id", database)).toMatchObject({ customerCount: 5 })
    expect(await database.customers.get(["store-id", "moussa"])).toMatchObject({ serverBalance: 1_000 })
  })

  it("does not invent a ready book from a single upsert", async () => {
    const database = openDatabase()

    await upsertLocalCustomer(customer(), database)

    expect(await database.metadata.get(customerBookMetadataKey("store-id"))).toBeUndefined()
    expect(await getCustomerBookMetadata("store-id", database)).toBeNull()
  })
})

describe("searchLocalCustomers", () => {
  async function search(query: string) {
    const database = openDatabase()
    await saveCustomerBook("store-id", book, database)
    return (await searchLocalCustomers("store-id", query, 8, database)).map((c) => c.id)
  }

  it("finds by any part of the phone number", async () => {
    expect(await search("77 123")).toEqual(["moussa"])
    expect(await search("4567")).toEqual(["moussa"])
    expect(await search("+221 76")).toEqual(["aissatou"])
  })

  it("finds by name regardless of accents, case and word order", async () => {
    expect(await search("aissatou")).toEqual(["aissatou"])
    expect(await search("FALL moussa")).toEqual(["moussa"])
    expect(await search("voisine")).toEqual(["voisine"])
  })

  it("never proposes a deactivated customer", async () => {
    expect(await search("moussa")).toEqual(["moussa"])
    expect(await search("780000")).toEqual([])
  })

  it("returns nothing for an empty query", async () => {
    expect(await search("   ")).toEqual([])
  })
})
