// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"

import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { lineTotal } from "../../utils/quantity"
import type { LocalCart } from "../../db/types"
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
  onSuspend: ReturnType<typeof vi.fn>
  onResumeHeldCart: ReturnType<typeof vi.fn>
  onDeleteHeldCart: ReturnType<typeof vi.fn>
}

function renderCart(
  items: CartItem[],
  overrides: Partial<Callbacks> = {},
  heldCarts: LocalCart[] = [],
) {
  const callbacks: Callbacks = {
    onQuantityChange: vi.fn(),
    onPriceChange: vi.fn(),
    onRemove: vi.fn(),
    onClear: vi.fn(),
    onCheckout: vi.fn(),
    onSuspend: vi.fn(),
    onResumeHeldCart: vi.fn(),
    onDeleteHeldCart: vi.fn(),
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
      onSuspend={callbacks.onSuspend}
      heldCarts={heldCarts}
      onResumeHeldCart={callbacks.onResumeHeldCart}
      onDeleteHeldCart={callbacks.onDeleteHeldCart}
    />,
  )
  return callbacks
}

function buildHeldCart(overrides: Partial<LocalCart> = {}): LocalCart {
  return {
    id: "held-1",
    cashSessionId: "session-a",
    status: "HELD",
    items: [coca],
    createdAt: "2026-08-28T10:00:00Z",
    updatedAt: "2026-08-28T10:05:00Z",
    heldAt: "2026-08-28T10:05:00Z",
    ...overrides,
  }
}

afterEach(cleanup)

describe("Cart checkout action", () => {
  it("is disabled when the cart is empty", () => {
    renderCart([])
    expect(screen.getByRole("button", { name: "Encaisser" })).toBeDisabled()
    expect(screen.queryByText("0 produit dans la vente")).not.toBeInTheDocument()
  })

  it("shows the total and allows checkout when products exist", async () => {
    const user = userEvent.setup()
    const callbacks = renderCart([coca])
    expect(screen.getByRole("heading", { name: "Vente en cours" })).toBeInTheDocument()
    expect(screen.getByText("1 produit")).toBeInTheDocument()
    expect(screen.getAllByText("1 000 FCFA")).toHaveLength(2)
    await user.click(screen.getByRole("button", { name: "Encaisser" }))
    expect(callbacks.onCheckout).toHaveBeenCalledOnce()
  })
})

describe("Cart POS interactions", () => {
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
    expect(input).toHaveAttribute("placeholder", "Ex. 0,5")
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
    expect(screen.queryByRole("heading", { name: "Modifier la quantité" })).not.toBeInTheDocument()
    const input = screen.getByRole("textbox", { name: "Quantité de Coca 50cl" })
    expect(input).toHaveFocus()
    await user.clear(input)
    await user.type(input, "3{Enter}")
    expect(callbacks.onQuantityChange).toHaveBeenCalledWith("coca", 3000)
    expect(screen.getByRole("button", { name: "Quantité de Coca 50cl" })).toHaveTextContent("2")
  })

  it("applies a weighed quantity when the inline field loses focus", async () => {
    const user = userEvent.setup()
    const callbacks = renderCart([banana])
    await user.click(screen.getByLabelText("Quantité de Banane"))
    const input = screen.getByRole("textbox", { name: "Quantité de Banane" })
    await user.clear(input)
    await user.type(input, "0,750")
    await user.tab()
    expect(callbacks.onQuantityChange).toHaveBeenCalledWith("banana", 750)
  })

  it("keeps the quantity unchanged when Escape cancels inline editing", async () => {
    const user = userEvent.setup()
    const callbacks = renderCart([banana])
    await user.click(screen.getByLabelText("Quantité de Banane"))
    const input = screen.getByRole("textbox", { name: "Quantité de Banane" })
    await user.clear(input)
    await user.type(input, "0,750")
    await user.keyboard("{Escape}")
    expect(callbacks.onQuantityChange).not.toHaveBeenCalled()
    expect(screen.getByRole("button", { name: "Quantité de Banane" })).toHaveTextContent("0,5 kg")
  })

  it("rejects a fractional quantity for a unit product", async () => {
    const user = userEvent.setup()
    const callbacks = renderCart([coca])
    await user.click(screen.getByLabelText("Quantité de Coca 50cl"))
    const input = screen.getByRole("textbox", { name: "Quantité de Coca 50cl" })
    await user.clear(input)
    await user.type(input, "2,5{Enter}")
    expect(callbacks.onQuantityChange).not.toHaveBeenCalled()
    expect(screen.getByRole("button", { name: "Quantité de Coca 50cl" })).toHaveTextContent("2")
  })

  it("rejects an inline quantity above available stock", async () => {
    const user = userEvent.setup()
    const callbacks = renderCart([banana])
    await user.click(screen.getByLabelText("Quantité de Banane"))
    const input = screen.getByRole("textbox", { name: "Quantité de Banane" })
    expect(input.parentElement).toHaveTextContent("kg")
    await user.clear(input)
    await user.type(input, "11{Enter}")
    expect(callbacks.onQuantityChange).not.toHaveBeenCalled()
    expect(screen.getByRole("button", { name: "Quantité de Banane" })).toHaveTextContent("0,5 kg")
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
    const removeButton = screen.getByRole("button", { name: "Supprimer Coca 50cl du panier" })
    expect(removeButton).toHaveAttribute("title", "Supprimer l’article")
    expect(removeButton).not.toHaveTextContent("Supprimer")
    await user.click(removeButton)
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

  it("suspends the current sale on demand", async () => {
    const user = userEvent.setup()
    const callbacks = renderCart([coca])
    await user.click(screen.getByRole("button", { name: /Suspendre/ }))
    expect(callbacks.onSuspend).toHaveBeenCalledOnce()
  })

  it("hides suspend and clear when the cart is empty, but still shows held carts", () => {
    renderCart([], {}, [buildHeldCart()])
    expect(screen.queryByRole("button", { name: /Suspendre/ })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Vider" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: /En attente/ })).toBeInTheDocument()
  })
})

describe("Held carts", () => {
  it("resumes a held cart directly when the active cart is empty", async () => {
    const user = userEvent.setup()
    const callbacks = renderCart([], {}, [buildHeldCart()])
    await user.click(screen.getByRole("button", { name: /En attente/ }))
    expect(screen.getByRole("heading", { name: "Paniers en attente" })).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Reprendre" }))
    expect(callbacks.onResumeHeldCart).toHaveBeenCalledWith("held-1", "direct")
  })

  it("asks to hold or clear the active cart before resuming a held one", async () => {
    const user = userEvent.setup()
    const callbacks = renderCart([banana], {}, [buildHeldCart()])
    await user.click(screen.getByRole("button", { name: /En attente/ }))
    await user.click(screen.getByRole("button", { name: "Reprendre" }))
    expect(screen.getByRole("heading", { name: "Panier actuel non vide" })).toBeInTheDocument()
    expect(callbacks.onResumeHeldCart).not.toHaveBeenCalled()

    await user.click(screen.getByRole("button", { name: "Mettre en attente et reprendre" }))
    expect(callbacks.onResumeHeldCart).toHaveBeenCalledWith("held-1", "hold")
  })

  it("clears the active cart and resumes when that choice is made", async () => {
    const user = userEvent.setup()
    const callbacks = renderCart([banana], {}, [buildHeldCart()])
    await user.click(screen.getByRole("button", { name: /En attente/ }))
    await user.click(screen.getByRole("button", { name: "Reprendre" }))
    await user.click(screen.getByRole("button", { name: "Vider et reprendre" }))
    expect(callbacks.onResumeHeldCart).toHaveBeenCalledWith("held-1", "clear")
  })

  it("deletes a held cart after confirmation", async () => {
    const user = userEvent.setup()
    const callbacks = renderCart([], {}, [buildHeldCart()])
    await user.click(screen.getByRole("button", { name: /En attente/ }))
    await user.click(screen.getByRole("button", { name: "Supprimer le panier en attente (1 article)" }))
    expect(screen.getByRole("heading", { name: "Supprimer ce panier ?" })).toBeInTheDocument()
    expect(callbacks.onDeleteHeldCart).not.toHaveBeenCalled()
    await user.click(screen.getByRole("button", { name: "Supprimer le panier" }))
    expect(callbacks.onDeleteHeldCart).toHaveBeenCalledWith("held-1")
  })
})
