import "fake-indexeddb/auto"

import { afterEach, describe, expect, it } from "vitest"

import type { Product } from "../types/api"
import { PosDatabase } from "./database"
import {
  buildLocalProducts,
  getProductCatalogMetadata,
  productCatalogMetadataKey,
  saveProductCatalog,
} from "./products"
import type { LocalProduct, LocalSale } from "./types"

const cachedAt = "2026-08-17T20:00:00.000Z"
const product: Product = {
  id: "product-id",
  name: "Coca 50cl",
  barcode: "123456",
  selling_price: "500.00",
  purchase_price: null,
  is_active: true,
  stock: 20,
  created_at: "2026-08-01T00:00:00Z",
  updated_at: "2026-08-16T00:00:00Z",
}

const databases: PosDatabase[] = []

afterEach(async () => {
  await Promise.all(databases.map(async (database) => {
    database.close()
    await database.delete()
  }))
  databases.length = 0
})

describe("product catalog cache", () => {
  it("maps API products to integer-valued local products", () => {
    expect(buildLocalProducts("store-id", [product], [], cachedAt)).toEqual([
      {
        id: product.id,
        storeId: "store-id",
        name: product.name,
        barcode: product.barcode,
        sellingPrice: 500,
        serverKnownStock: 20,
        pendingSoldQuantity: 0,
        isActive: true,
        updatedAt: product.updated_at,
        cachedAt,
      },
    ])
  })

  it("preserves quantities already sold offline during a server refresh", () => {
    const existing: LocalProduct = {
      ...buildLocalProducts("store-id", [product], [], cachedAt)[0]!,
      serverKnownStock: 22,
      pendingSoldQuantity: 3,
    }

    const refreshed = buildLocalProducts(
      "store-id",
      [{ ...product, stock: 20 }],
      [existing],
      "2026-08-17T21:00:00.000Z",
    )

    expect(refreshed[0]).toMatchObject({
      serverKnownStock: 20,
      pendingSoldQuantity: 3,
    })
  })

  it("rejects fractional FCFA prices before replacing the cache", () => {
    expect(() =>
      buildLocalProducts(
        "store-id",
        [{ ...product, selling_price: "500.50" }],
        [],
        cachedAt,
      ),
    ).toThrow("Montant produit invalide")
  })

  it("uses a store-scoped metadata key", () => {
    expect(productCatalogMetadataKey("store-id")).toBe(
      "product-catalog:store-id",
    )
  })

  it("repairs the pending stock counter from unsynced sales during refresh", async () => {
    const database = new PosDatabase()
    databases.push(database)
    const staleLocalProduct: LocalProduct = {
      ...buildLocalProducts("store-id", [product], [], cachedAt)[0]!,
      pendingSoldQuantity: 9,
    }
    const pendingSale = {
      id: "pending-sale",
      storeId: "store-id",
      status: "PENDING_SYNC",
      items: [{ productId: product.id, quantity: 2 }],
    } as LocalSale
    const syncedSale = {
      id: "synced-sale",
      storeId: "store-id",
      status: "SYNCED",
      items: [{ productId: product.id, quantity: 5 }],
    } as LocalSale
    await database.products.put(staleLocalProduct)
    await database.localSales.bulkPut([pendingSale, syncedSale])

    await saveProductCatalog("store-id", [product], database)

    const refreshed = await database.products.get(["store-id", product.id])
    expect(refreshed?.pendingSoldQuantity).toBe(2)
  })

  it("rejects catalog metadata when the product snapshot is incomplete", async () => {
    const database = new PosDatabase()
    databases.push(database)
    await database.metadata.put({
      key: productCatalogMetadataKey("store-id"),
      value: { storeId: "store-id", cachedAt, productCount: 1 },
      updatedAt: cachedAt,
    })

    await expect(getProductCatalogMetadata("store-id", database)).resolves.toBeNull()
  })
})
