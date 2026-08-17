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
  LocalProductNotFoundError,
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

function setOnline(value: boolean) {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(value)
}

afterEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe("offline product service", () => {
  it("looks up a barcode locally without calling the API when offline", async () => {
    setOnline(false)
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

  it("filters through the local repository when searching offline", async () => {
    setOnline(false)
    vi.mocked(hasLocalProductCatalog).mockResolvedValue(true)
    vi.mocked(searchLocalProducts).mockResolvedValue([localCoca])

    await expect(searchProducts("store-id", "coca")).resolves.toMatchObject([
      { name: "Coca 50cl", stock: 18 },
    ])
    expect(searchLocalProducts).toHaveBeenCalledWith("store-id", "coca")
    expect(getProducts).not.toHaveBeenCalled()
  })

  it("falls back to IndexedDB when an online API request cannot connect", async () => {
    setOnline(true)
    vi.mocked(getProducts).mockRejectedValue(new NetworkError())
    vi.mocked(hasLocalProductCatalog).mockResolvedValue(true)
    vi.mocked(findLocalProductByBarcode).mockResolvedValue(localCoca)

    await expect(getProductByBarcode("store-id", "123456")).resolves.toMatchObject({
      id: localCoca.id,
      stock: 18,
    })
  })

  it("reports a missing local catalog explicitly", async () => {
    setOnline(false)
    vi.mocked(hasLocalProductCatalog).mockResolvedValue(false)

    await expect(searchProducts("store-id", "coca")).rejects.toBeInstanceOf(
      LocalCatalogUnavailableError,
    )
  })

  it("reports an unknown offline barcode without retrying the API", async () => {
    setOnline(false)
    vi.mocked(hasLocalProductCatalog).mockResolvedValue(true)
    vi.mocked(findLocalProductByBarcode).mockResolvedValue(null)

    await expect(getProductByBarcode("store-id", "999999")).rejects.toBeInstanceOf(
      LocalProductNotFoundError,
    )
    expect(getProducts).not.toHaveBeenCalled()
  })
})
