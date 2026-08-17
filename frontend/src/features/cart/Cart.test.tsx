// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"

import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { Cart } from "./Cart"
import type { CartItem } from "./cartState"

const coca: CartItem = {
  productId: "coca",
  name: "Coca 50cl",
  unitPrice: 500,
  quantity: 2,
  stock: 20,
}

function renderCart(items: CartItem[], onCheckout = vi.fn()) {
  render(
    <Cart
      items={items}
      total={items.reduce((total, item) => total + item.unitPrice * item.quantity, 0)}
      onIncrement={vi.fn()}
      onDecrement={vi.fn()}
      onQuantityChange={vi.fn()}
      onRemove={vi.fn()}
      onClear={vi.fn()}
      onCheckout={onCheckout}
    />,
  )
}

afterEach(cleanup)

describe("Cart checkout action", () => {
  it("is disabled when the cart is empty", () => {
    renderCart([])

    expect(screen.getByRole("button", { name: "Encaisser" })).toBeDisabled()
  })

  it("shows the total and allows checkout when products exist", async () => {
    const user = userEvent.setup()
    const onCheckout = vi.fn()
    renderCart([coca], onCheckout)

    expect(screen.getAllByText("1 000 FCFA")).toHaveLength(2)
    await user.click(screen.getByRole("button", { name: "Encaisser" }))
    expect(onCheckout).toHaveBeenCalledOnce()
  })
})
