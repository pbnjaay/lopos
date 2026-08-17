// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import type { CatalogProduct } from "../products/types"
import { loadCartForSession } from "./cartStorage"
import { useCart } from "./useCart"

const coca: CatalogProduct = {
  id: "coca",
  name: "Coca 50cl",
  barcode: null,
  sellingPrice: 500,
  isActive: true,
  stock: 20,
}

afterEach(() => {
  localStorage.clear()
})

describe("useCart persistence", () => {
  it("persists cart changes under the current session", () => {
    const { result } = renderHook(() => useCart("session-a"))

    act(() => result.current.addItem(coca))

    expect(loadCartForSession("session-a")).toMatchObject([{ productId: "coca", quantity: 1 }])
  })

  it("restores a cart already saved for the session on mount", () => {
    const { result: first } = renderHook(() => useCart("session-a"))
    act(() => first.current.addItem(coca))

    const { result: remounted } = renderHook(() => useCart("session-a"))

    expect(remounted.current.items).toMatchObject([{ productId: "coca", quantity: 1 }])
  })

  it("does not restore a cart left over from a different session", () => {
    const { result: previous } = renderHook(() => useCart("old-session"))
    act(() => previous.current.addItem(coca))

    const { result: current } = renderHook(() => useCart("new-session"))

    expect(current.current.items).toEqual([])
  })

  it("switches to the new session's cart when the session id changes", () => {
    const { result, rerender } = renderHook(({ sessionId }) => useCart(sessionId), {
      initialProps: { sessionId: "session-a" as string | null },
    })
    act(() => result.current.addItem(coca))

    rerender({ sessionId: "session-b" })

    expect(result.current.items).toEqual([])
  })
})
