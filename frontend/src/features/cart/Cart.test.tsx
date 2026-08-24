// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"

import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { lineTotal } from "../../utils/quantity"
import { Cart } from "./Cart"
import { QuantityDialog } from "./CartDialogs"
import type { CartItem } from "./cartState"

const coca: CartItem = {
  productId: "coca",
  name: "Coca 50cl",
  unitPrice: 500,
  catalogUnitPrice: 500,
  saleUnit: "UNIT",
  quantityMilli: 2000,
  stockMilli: 20_000,
}

const banana: CartItem = {
  productId: "banana",
  name: "Banane",
  unitPrice: 700,
  catalogUnitPrice: 700,
  saleUnit: "KG",
  quantityMilli: 500,
  stockMilli: 10_000,
}

type Callbacks = {
  onQuantityChange: ReturnType<typeof vi.fn>
  onPriceChange: ReturnType<typeof vi.fn>
  onRemove: ReturnType<typeof vi.fn>
  onClear: ReturnType<typeof vi.fn>
  onCheckout: ReturnType<typeof vi.fn>
}

function renderCart(items: CartItem[], overrides: Partial<Callbacks> = {}) {
  const callbacks: Callbacks = {
    onQuantityChange: vi.fn(),
    onPriceChange: vi.fn(),
    onRemove: vi.fn(),
    onClear: vi.fn(),
    onCheckout: vi.fn(),
    ...overrides,
  }
  render(
    <Cart
      items={items}
      total={items.reduce((total, item) => total + lineTotal(item.unitPrice, item.quantityMilli ?? 0), 0)}
      onIncrement={vi.fn()}
      onDecrement={vi.fn()}
      onQuantityChange={callbacks.onQuantityChange}
      onPriceChange={callbacks.onPriceChange}
      onRemove={callbacks.onRemove}
      onClear={callbacks.onClear}
      onCheckout={callbacks.onCheckout}
    />,
  )
  return callbacks
}

afterEach(cleanup)

describe("Cart checkout action", () => {
  it("is disabled when the cart is empty", () => {
    renderCart([])
    expect(screen.getByRole("button", { name: "Encaisser" })).toBeDisabled()
  })

  it("shows the total and allows checkout when products exist", async () => {
    const user = userEvent.setup()
    const callbacks = renderCart([coca])
    expect(screen.getAllByText("1 000 FCFA")).toHaveLength(2)
    await user.click(screen.getByRole("button", { name: "Encaisser" }))
    expect(callbacks.onCheckout).toHaveBeenCalledOnce()
  })
})

describe("Cart POS dialogs", () => {
  it("starts an initial weighed quantity empty and requires a valid value", async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(
      <QuantityDialog
        item={banana}
        quantityMilli={null}
        onApply={onApply}
        onClose={vi.fn()}
      />,
    )
    const input = screen.getByLabelText("Quantité")
    expect(input).toHaveValue("")
    expect(input).toHaveAttribute("placeholder", "0,000")
    expect(screen.getByRole("button", { name: "Appliquer" })).toBeDisabled()

    await user.type(input, "0,750")
    expect(screen.getByRole("button", { name: "Appliquer" })).toBeEnabled()
    await user.keyboard("{Enter}")
    expect(onApply).toHaveBeenCalledWith(750)
  })

  it("changes a unit quantity with Enter", async () => {
    const user = userEvent.setup()
    const callbacks = renderCart([coca])
    await user.click(screen.getByLabelText("Quantité de Coca 50cl"))
    expect(screen.getByRole("heading", { name: "Modifier la quantité" })).toBeInTheDocument()
    const input = screen.getByLabelText("Quantité")
    expect(input).toHaveFocus()
    await user.clear(input)
    await user.type(input, "3{Enter}")
    expect(callbacks.onQuantityChange).toHaveBeenCalledWith("coca", 3000)
    expect(screen.queryByRole("heading", { name: "Modifier la quantité" })).not.toBeInTheDocument()
  })

  it("keeps the quantity unchanged when Escape closes the dialog", async () => {
    const user = userEvent.setup()
    const callbacks = renderCart([banana])
    await user.click(screen.getByLabelText("Quantité de Banane"))
    const input = screen.getByLabelText("Quantité")
    await user.clear(input)
    await user.type(input, "0,750")
    await user.keyboard("{Escape}")
    expect(callbacks.onQuantityChange).not.toHaveBeenCalled()
    expect(screen.queryByRole("heading", { name: "Modifier la quantité" })).not.toBeInTheDocument()
  })

  it("changes the price with Enter", async () => {
    const user = userEvent.setup()
    const callbacks = renderCart([banana])
    const priceButton = screen.getByRole("button", { name: "Modifier le prix" })
    expect(priceButton).toHaveTextContent("Prix")
    expect(priceButton).toHaveAttribute("title", "Modifier le prix")
    await user.click(priceButton)
    const input = screen.getByLabelText("Prix pour cette vente")
    expect(input).toHaveFocus()
    await user.clear(input)
    await user.type(input, "650{Enter}")
    expect(callbacks.onPriceChange).toHaveBeenCalledWith("banana", 650)
    expect(screen.queryByRole("heading", { name: "Modifier le prix" })).not.toBeInTheDocument()
  })

  it("makes a catalog-price override visible", () => {
    renderCart([{ ...banana, unitPrice: 650 }])
    expect(screen.getByText("Prix modifié")).toBeInTheDocument()
    expect(screen.getByText("700 FCFA/kg")).toBeInTheDocument()
  })

  it("removes a line immediately without browser confirmation", async () => {
    const user = userEvent.setup()
    const callbacks = renderCart([coca])
    await user.click(screen.getByRole("button", { name: "Supprimer Coca 50cl du panier" }))
    expect(callbacks.onRemove).toHaveBeenCalledWith("coca")
  })

  it("requires an in-app confirmation before clearing the cart", async () => {
    const user = userEvent.setup()
    const callbacks = renderCart([coca, banana])
    await user.click(screen.getByRole("button", { name: "Vider" }))
    expect(screen.getByRole("heading", { name: "Vider le panier ?" })).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Annuler" }))
    expect(callbacks.onClear).not.toHaveBeenCalled()
    await user.click(screen.getByRole("button", { name: "Vider" }))
    await user.click(screen.getByRole("button", { name: "Vider le panier" }))
    expect(callbacks.onClear).toHaveBeenCalledOnce()
  })
})
