// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook, waitFor } from "@testing-library/react"
import type { PropsWithChildren } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { getProductCatalog } from "../../api/products"
import { getProductCatalogMetadata, saveProductCatalog } from "../../db/products"
import { useProductCatalog } from "./queries"

vi.mock("../../api/products", () => ({ getProductCatalog: vi.fn() }))
vi.mock("../../db/products", () => ({
  getProductCatalogMetadata: vi.fn(),
  saveProductCatalog: vi.fn(),
}))

afterEach(() => {
  vi.clearAllMocks()
})

describe("useProductCatalog", () => {
  it("refreshes the complete snapshot at startup and on reconnect", async () => {
    vi.mocked(getProductCatalogMetadata).mockResolvedValue({
      storeId: "store-id",
      cachedAt: "2026-08-28T10:00:00Z",
      productCount: 13,
    })
    vi.mocked(getProductCatalog).mockResolvedValue([])
    vi.mocked(saveProductCatalog).mockResolvedValue()
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, networkMode: "always" } },
    })
    const wrapper = ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )

    renderHook(() => useProductCatalog("store-id"), { wrapper })
    await waitFor(() => expect(getProductCatalog).toHaveBeenCalledTimes(1))

    window.dispatchEvent(new Event("online"))
    await waitFor(() => expect(getProductCatalog).toHaveBeenCalledTimes(2))
  })
})
