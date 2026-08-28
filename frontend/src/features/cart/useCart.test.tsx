// @vitest-environment jsdom

import "fake-indexeddb/auto"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import type { PropsWithChildren } from "react"
import { afterEach, describe, expect, it } from "vitest"

import { db } from "../../db/database"
import type { LocalProduct } from "../../db/types"
import type { CatalogProduct } from "../products/types"
import { saveCartForSession } from "./cartStorage"
import { useCart } from "./useCart"

const coca: CatalogProduct = {
  id: "coca",
  name: "Coca 50cl",
  barcode: null,
  sellingPrice: 500,
  isActive: true,
  stock: 20,
}

function wrapper({ children }: PropsWithChildren) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, networkMode: "always" } },
  })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

const cocaProduct: LocalProduct = {
  id: "coca",
  storeId: "store-a",
  name: "Coca 50cl",
  barcode: null,
  sellingPrice: 500,
  serverKnownStockMilli: 20_000,
  pendingSoldQuantityMilli: 0,
  isActive: true,
  cachedAt: "2026-08-28T10:00:00Z",
}

afterEach(async () => {
  cleanup()
  localStorage.clear()
  await db.carts.clear()
  await db.products.clear()
})

describe("useCart persistence", () => {
  it("persists cart changes for the current session in Dexie", async () => {
    const { result } = renderHook(() => useCart("session-a", "store-a"), { wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await act(async () => {
      await result.current.addItem(coca)
    })

    await waitFor(async () => {
      const stored = await db.carts.where("cashSessionId").equals("session-a").first()
      expect(stored?.items).toMatchObject([{ productId: "coca", quantity: 1 }])
    })
  })

  it("restores a cart already saved for the session on mount", async () => {
    const { result: first } = renderHook(() => useCart("session-a", "store-a"), { wrapper })
    await waitFor(() => expect(first.current.isLoading).toBe(false))
    await act(async () => {
      await first.current.addItem(coca)
    })

    const { result: remounted } = renderHook(() => useCart("session-a", "store-a"), { wrapper })
    await waitFor(() =>
      expect(remounted.current.items).toMatchObject([{ productId: "coca", quantity: 1 }]),
    )
  })

  it("does not restore a cart left over from a different session", async () => {
    const { result: previous } = renderHook(() => useCart("old-session", "store-a"), { wrapper })
    await waitFor(() => expect(previous.current.isLoading).toBe(false))
    await act(async () => {
      await previous.current.addItem(coca)
    })

    const { result: current } = renderHook(() => useCart("new-session", "store-a"), { wrapper })
    await waitFor(() => expect(current.current.isLoading).toBe(false))
    expect(current.current.items).toEqual([])
  })

  it("adopts a cart left in localStorage from before the Dexie migration", async () => {
    saveCartForSession("legacy-session", [
      { productId: "coca", name: "Coca 50cl", unitPrice: 500, quantity: 2 },
    ])

    const { result } = renderHook(() => useCart("legacy-session", "store-a"), { wrapper })

    await waitFor(() =>
      expect(result.current.items).toMatchObject([{ productId: "coca", quantity: 2 }]),
    )
  })
})

describe("useCart suspend/resume", () => {
  it("moves the cart to the held list and starts a fresh empty cart", async () => {
    const { result } = renderHook(() => useCart("session-a", "store-a"), { wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    await act(async () => {
      await result.current.addItem(coca)
    })

    await act(async () => {
      await result.current.holdCart()
    })

    await waitFor(() => expect(result.current.items).toEqual([]))
    await waitFor(() => expect(result.current.heldCarts.count).toBe(1))
  })

  it("resumes a held cart back into the (empty) active cart", async () => {
    await db.products.put(cocaProduct)
    const { result } = renderHook(() => useCart("session-a", "store-a"), { wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    await act(async () => {
      await result.current.addItem(coca)
    })
    await act(async () => {
      await result.current.holdCart()
    })
    await waitFor(() => expect(result.current.heldCarts.count).toBe(1))
    const heldCartId = result.current.heldCarts.list[0]!.id

    await act(async () => {
      await result.current.resumeCart(heldCartId)
    })

    await waitFor(() =>
      expect(result.current.items).toMatchObject([{ productId: "coca", quantity: 1 }]),
    )
    expect(result.current.heldCarts.count).toBe(0)
  })

  it("removes a held cart on delete", async () => {
    const { result } = renderHook(() => useCart("session-a", "store-a"), { wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    await act(async () => {
      await result.current.addItem(coca)
    })
    await act(async () => {
      await result.current.holdCart()
    })
    await waitFor(() => expect(result.current.heldCarts.count).toBe(1))
    const heldCartId = result.current.heldCarts.list[0]!.id

    await act(async () => {
      await result.current.deleteHeldCart(heldCartId)
    })

    await waitFor(() => expect(result.current.heldCarts.count).toBe(0))
  })
})
