import { describe, expect, it } from "vitest"

import { POS_DATABASE_NAME, POS_DATABASE_VERSION, PosDatabase } from "./database"

describe("PosDatabase schema", () => {
  it("declares the versioned Phase E tables", () => {
    const database = new PosDatabase()

    expect(database.name).toBe(POS_DATABASE_NAME)
    expect(database.verno).toBe(POS_DATABASE_VERSION)
    expect(database.tables.map((table) => table.name)).toEqual([
      "products",
      "localSales",
      "cashSessions",
      "metadata",
      "carts",
    ])
  })

  it("indexes barcode lookup and the pending sales queue", () => {
    const database = new PosDatabase()
    const productIndexes = database.products.schema.indexes.map((index) => index.src)
    const saleIndexes = database.localSales.schema.indexes.map((index) => index.src)

    expect(database.products.schema.primKey.src).toBe("[storeId+id]")
    expect(productIndexes).toContain("[storeId+barcode]")
    expect(saleIndexes).toContain("[status+createdAt]")
  })
})
