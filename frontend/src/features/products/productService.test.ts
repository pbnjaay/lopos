// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest"

import { getProducts } from "../../api/products"
import { NetworkError } from "../../api/client"
import {
  findLocalProductByBarcode,
  hasLocalProductCatalog,
  searchLocalProducts,
} from "../../db/products"
import type { LocalProduct } from "../../db/types"
import {
  LocalCatalogUnavailableError,
  getProductByBarcode,
  searchProducts,
} from "./productService"

vi.mock("../../api/products", () => ({ getProducts: vi.fn() }))
vi.mock("../../db/products", () => ({
  findLocalProductByBarcode: vi.fn(),
  hasLocalProductCatalog: vi.fn(),
  searchLocalProducts: vi.fn(),
}))

const localCoca: LocalProduct = {
  id: "product-id",
  storeId: "store-id",
  name: "Coca 50cl",
  barcode: "123456",
  sellingPrice: 500,
  serverKnownStock: 20,
  pendingSoldQuantity: 2,
  isActive: true,
  updatedAt: "2026-08-17T00:00:00Z",
  cachedAt: "2026-08-17T00:01:00Z",
}

afterEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe("local-first product service", () => {
  it("looks up a barcode in IndexedDB without calling the API once the catalog is ready", async () => {
    vi.mocked(hasLocalProductCatalog).mockResolvedValue(true)
    vi.mocked(findLocalProductByBarcode).mockResolvedValue(localCoca)

    await expect(getProductByBarcode("store-id", "123456")).resolves.toEqual({
      id: localCoca.id,
      name: localCoca.name,
      barcode: localCoca.barcode,
      sellingPrice: 500,
      stock: 18,
      isActive: true,
    })
    expect(getProducts).not.toHaveBeenCalled()
  })

  it("searches IndexedDB without calling the API once the catalog is ready", async () => {
    vi.mocked(hasLocalProductCatalog).mockResolvedValue(true)
    vi.mocked(searchLocalProducts).mockResolvedValue([localCoca])

    await expect(searchProducts("store-id", "coca")).resolves.toMatchObject([
      { name: "Coca 50cl", stock: 18 },
    ])
    expect(searchLocalProducts).toHaveBeenCalledWith("store-id", "coca")
    expect(getProducts).not.toHaveBeenCalled()
  })

  it("returns null for a barcode absent from the ready catalog without retrying the API", async () => {
    vi.mocked(hasLocalProductCatalog).mockResolvedValue(true)
    vi.mocked(findLocalProductByBarcode).mockResolvedValue(null)

    await expect(getProductByBarcode("store-id", "999999")).resolves.toBeNull()
    expect(getProducts).not.toHaveBeenCalled()
  })

  it("falls back to the API while the catalog has never been initialized", async () => {
    vi.mocked(hasLocalProductCatalog).mockResolvedValue(false)
    vi.mocked(getProducts).mockResolvedValue([
      {
        id: localCoca.id,
        name: localCoca.name,
        barcode: localCoca.barcode,
        selling_price: "500.00",
        purchase_price: null,
        is_active: true,
        stock: 20,
        created_at: "2026-08-17T00:00:00Z",
        updated_at: "2026-08-17T00:00:00Z",
      },
    ])

    await expect(searchProducts("store-id", "coca")).resolves.toMatchObject([
      { name: "Coca 50cl", stock: 20 },
    ])
    expect(getProducts).toHaveBeenCalledWith({ storeId: "store-id", search: "coca" })
  })

  it("reports a missing local catalog explicitly when the API is unreachable", async () => {
    vi.mocked(hasLocalProductCatalog).mockResolvedValue(false)
    vi.mocked(getProducts).mockRejectedValue(new NetworkError())

    await expect(searchProducts("store-id", "coca")).rejects.toBeInstanceOf(
      LocalCatalogUnavailableError,
    )
    await expect(getProductByBarcode("store-id", "123456")).rejects.toBeInstanceOf(
      LocalCatalogUnavailableError,
    )
  })

  it("surfaces non-network API errors while the catalog is not initialized", async () => {
    vi.mocked(hasLocalProductCatalog).mockResolvedValue(false)
    const validationError = new Error("Identifiant de magasin invalide.")
    vi.mocked(getProducts).mockRejectedValue(validationError)

    await expect(searchProducts("store-id", "coca")).rejects.toBe(validationError)
  })
})
