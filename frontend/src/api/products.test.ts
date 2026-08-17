// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest"

import { getProductCatalog, getProducts } from "./products"

afterEach(() => {
  vi.restoreAllMocks()
})

describe("products API", () => {
  it("searches by name with the required store id", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } }),
    )

    await getProducts({ storeId: "store-id", search: "coca zéro" })

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/v1/products/?store_id=store-id&search=coca+z%C3%A9ro",
    )
  })

  it("performs an exact barcode lookup", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } }),
    )

    await getProducts({ storeId: "store-id", barcode: "123456789" })

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/v1/products/?store_id=store-id&barcode=123456789",
    )
  })

  it("loads the complete store catalog without a search filter", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } }),
    )

    await getProductCatalog("store-id")

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/v1/products/?store_id=store-id",
    )
  })
})
