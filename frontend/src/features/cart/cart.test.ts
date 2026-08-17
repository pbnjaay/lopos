import { describe, expect, it } from "vitest"

import type { CatalogProduct } from "../products/types"
import {
  addItem,
  clearCart,
  decrementItem,
  getCartTotal,
  incrementItem,
  removeItem,
  setItemQuantity,
} from "./cartState"

function product(
  id: string,
  name: string,
  sellingPrice: number,
  stock: number,
): CatalogProduct {
  return {
    id,
    name,
    barcode: null,
    sellingPrice,
    isActive: true,
    stock,
  }
}

const coca = product("coca", "Coca 50cl", 500, 2)
const bread = product("bread", "Pain", 200, 10)

describe("cart", () => {
  it("adds a product and increments an existing line", () => {
    const once = addItem([], coca)
    const twice = addItem(once, coca)

    expect(once).toMatchObject([{ productId: "coca", quantity: 1 }])
    expect(twice).toMatchObject([{ productId: "coca", quantity: 2 }])
  })

  it("never exceeds the known stock", () => {
    const fullStock = addItem(addItem([], coca), coca)

    expect(addItem(fullStock, coca)[0]?.quantity).toBe(2)
    expect(incrementItem(fullStock, "coca")[0]?.quantity).toBe(2)
    expect(addItem([], product("empty", "Vide", 100, 0))).toEqual([])
  })

  it("decrements without allowing a zero quantity", () => {
    const twice = addItem(addItem([], coca), coca)
    const once = decrementItem(twice, "coca")

    expect(once[0]?.quantity).toBe(1)
    expect(decrementItem(once, "coca")[0]?.quantity).toBe(1)
  })

  it("sets a quantity directly and clamps it to known stock", () => {
    const once = addItem([], product("bulk", "Produit en lot", 100, 20))

    expect(setItemQuantity(once, "bulk", 20)[0]?.quantity).toBe(20)
    expect(setItemQuantity(once, "bulk", 30)[0]?.quantity).toBe(20)
    expect(setItemQuantity(once, "bulk", 0)[0]?.quantity).toBe(1)
  })

  it("removes one product or clears the full cart", () => {
    const items = addItem(addItem([], coca), bread)

    expect(removeItem(items, "coca").map((item) => item.productId)).toEqual(["bread"])
    expect(clearCart()).toEqual([])
  })

  it("calculates the total from integer FCFA prices", () => {
    const items = addItem(addItem(addItem([], coca), coca), bread)

    expect(getCartTotal(items)).toBe(1_200)
  })
})
