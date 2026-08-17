// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest"

import type { CartItem } from "./cartState"
import { loadCartForSession, saveCartForSession } from "./cartStorage"

const coca: CartItem = { productId: "coca", name: "Coca 50cl", unitPrice: 500, quantity: 2, stock: 20 }

afterEach(() => {
  localStorage.clear()
})

describe("cart storage", () => {
  it("returns an empty cart without a session", () => {
    expect(loadCartForSession(null)).toEqual([])
  })

  it("round-trips a cart for a given session", () => {
    saveCartForSession("session-a", [coca])
    expect(loadCartForSession("session-a")).toEqual([coca])
  })

  it("does not leak a cart across different sessions", () => {
    saveCartForSession("session-a", [coca])
    expect(loadCartForSession("session-b")).toEqual([])
  })

  it("clears the stored cart once it becomes empty", () => {
    saveCartForSession("session-a", [coca])
    saveCartForSession("session-a", [])
    expect(loadCartForSession("session-a")).toEqual([])
    expect(localStorage.getItem("lopos.cart.session-a")).toBeNull()
  })

  it("ignores corrupted storage instead of throwing", () => {
    localStorage.setItem("lopos.cart.session-a", "not json")
    expect(loadCartForSession("session-a")).toEqual([])
  })
})
