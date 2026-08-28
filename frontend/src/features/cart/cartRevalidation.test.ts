import "fake-indexeddb/auto"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { PosDatabase } from "../../db/database"
import type { LocalProduct } from "../../db/types"
import { revalidateCartItems } from "./cartRevalidation"
import type { CartItem } from "./cartState"

let database: PosDatabase

const coca: LocalProduct = {
  id: "coca-id",
  storeId: "store-id",
  name: "Coca 50cl",
  barcode: "123",
  sellingPrice: 500,
  serverKnownStockMilli: 5_000,
  pendingSoldQuantityMilli: 0,
  isActive: true,
  cachedAt: "2026-08-28T10:00:00Z",
}

const banana: LocalProduct = {
  id: "banana-id",
  storeId: "store-id",
  name: "Banane",
  barcode: null,
  sellingPrice: 700,
  saleUnit: "KG",
  serverKnownStockMilli: 2_000,
  pendingSoldQuantityMilli: 0,
  isActive: true,
  cachedAt: "2026-08-28T10:00:00Z",
}

const cocaCartItem: CartItem = {
  productId: "coca-id",
  name: "Coca 50cl",
  unitPrice: 500,
  catalogUnitPrice: 500,
  saleUnit: "UNIT",
  quantityMilli: 3_000,
  stockMilli: 5_000,
}

beforeEach(async () => {
  database = new PosDatabase()
  await database.products.bulkPut([coca, banana])
})

afterEach(async () => {
  database.close()
  await database.delete()
})

describe("revalidateCartItems", () => {
  it("keeps an item unchanged when stock still covers it", async () => {
    const result = await revalidateCartItems([cocaCartItem], "store-id", database)
    expect(result.items).toEqual([{ ...cocaCartItem, stockMilli: 5_000, stock: 5 }])
    expect(result.removed).toEqual([])
    expect(result.reduced).toEqual([])
  })

  it("clamps quantity to the stock actually available now, preserving the overridden price", async () => {
    await database.products.update(["store-id", "coca-id"], { pendingSoldQuantityMilli: 4_500 })
    const overridden: CartItem = { ...cocaCartItem, unitPrice: 450 }

    const result = await revalidateCartItems([overridden], "store-id", database)

    expect(result.reduced).toEqual([
      { name: "Coca 50cl", saleUnit: "UNIT", fromMilli: 3_000, toMilli: 500 },
    ])
    expect(result.items[0]).toMatchObject({ unitPrice: 450, quantityMilli: 500 })
  })

  it("preserves a fractional KG quantity when stock still covers it", async () => {
    const weighed: CartItem = {
      productId: "banana-id",
      name: "Banane",
      unitPrice: 700,
      catalogUnitPrice: 700,
      saleUnit: "KG",
      quantityMilli: 750,
      stockMilli: 2_000,
    }

    const result = await revalidateCartItems([weighed], "store-id", database)

    expect(result.items[0]).toMatchObject({ quantityMilli: 750, saleUnit: "KG" })
    expect(result.reduced).toEqual([])
  })

  it("drops a product that was deactivated while the cart was held", async () => {
    await database.products.update(["store-id", "coca-id"], { isActive: false })

    const result = await revalidateCartItems([cocaCartItem], "store-id", database)

    expect(result.items).toEqual([])
    expect(result.removed).toEqual(["Coca 50cl"])
  })

  it("drops a product that no longer exists in the local catalog", async () => {
    const ghost: CartItem = { ...cocaCartItem, productId: "deleted-id", name: "Produit supprimé" }

    const result = await revalidateCartItems([ghost], "store-id", database)

    expect(result.items).toEqual([])
    expect(result.removed).toEqual(["Produit supprimé"])
  })

  it("drops a product that has completely sold out", async () => {
    await database.products.update(["store-id", "coca-id"], { pendingSoldQuantityMilli: 5_000 })

    const result = await revalidateCartItems([cocaCartItem], "store-id", database)

    expect(result.items).toEqual([])
    expect(result.removed).toEqual(["Coca 50cl"])
  })
})
