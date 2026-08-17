import { describe, expect, it } from "vitest"

import type { Product } from "../types/api"
import { buildLocalProducts, productCatalogMetadataKey } from "./products"
import type { LocalProduct } from "./types"

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
})
