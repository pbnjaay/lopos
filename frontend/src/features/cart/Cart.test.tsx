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
  onSuspend: ReturnType<typeof vi.fn>
}

function renderCart(items: CartItem[], overrides: Partial<Callbacks> = {}) {
  const callbacks: Callbacks = {
    onQuantityChange: vi.fn(),
    onPriceChange: vi.fn(),
    onRemove: vi.fn(),
    onClear: vi.fn(),
    onCheckout: vi.fn(),
    onSuspend: vi.fn(),
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
    />,
  )
  return callbacks
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
    const priceButton = screen.getByRole("button", { name: "Modifier le prix de Banane" })
    expect(priceButton).toHaveAttribute("title", "Modifier le prix")
    await user.click(priceButton)
    const input = screen.getByLabelText("Prix pour cette vente")
    expect(input).toHaveFocus()
    await user.clear(input)
    await user.type(input, "650{Enter}")
    expect(callbacks.onPriceChange).toHaveBeenCalledWith("banana", 650)
    expect(screen.queryByRole("heading", { name: "Modifier le prix" })).not.toBeInTheDocument()
  })

  // Le prix catalogue barré porte à lui seul l'information « prix modifié »,
  // et donne en plus le montant d'origine : pas de badge en doublon.
  it("makes a catalog-price override visible", () => {
    renderCart([{ ...banana, unitPrice: 650 }])
    expect(screen.queryByText("Prix modifié")).not.toBeInTheDocument()
    expect(screen.getByText(/650 FCFA \/ kg/)).toBeInTheDocument()
    expect(screen.getByText("700 FCFA")).toBeInTheDocument()
  })

  // À quantité 1 les deux montants sont identiques : seule l'unité explicite
  // dit lequel est le prix unitaire et lequel est le total de la ligne.
  it("distingue le prix unitaire du total de ligne", () => {
    renderCart([coca])
    expect(screen.getByText(/500 FCFA \/ unité/)).toBeInTheDocument()
    // 500 × 2 : total de ligne et total du panier, jamais confondus avec 500.
    expect(screen.getAllByText("1 000 FCFA")).toHaveLength(2)
  })

  it("libelle le prix unitaire au kilo pour un article pesé", () => {
    renderCart([banana])
    expect(screen.getByText(/700 FCFA \/ kg/)).toBeInTheDocument()
  })

  // Un panier de fin de journée : 12 lignes, un nom très long, des unités
  // et des kilos mélangés. Chaque ligne doit rester complète et lisible.
  it("tient un panier de douze articles, nom très long compris", () => {
    const longName =
      "Huile d’arachide raffinée première pression bidon de 5 litres — marque Sénégalaise"
    const items: CartItem[] = Array.from({ length: 12 }, (_, index) => ({
      productId: `product-${index}`,
      name: index === 0 ? longName : `Article ${index}`,
      unitPrice: 500 + index * 100,
      catalogUnitPrice: 500 + index * 100,
      saleUnit: index % 4 === 0 ? "KG" : "UNIT",
      quantityMilli: index % 4 === 0 ? 1500 : 1000 * ((index % 3) + 1),
      stockMilli: 50_000,
    }))

    renderCart(items)

    // Douze lignes, et chacune expose ses quatre commandes.
    expect(screen.getAllByRole("listitem")).toHaveLength(12)
    for (const item of items) {
      expect(screen.getByLabelText(`Quantité de ${item.name}`)).toBeInTheDocument()
      expect(
        screen.getByRole("button", { name: `Modifier le prix de ${item.name}` }),
      ).toBeInTheDocument()
      expect(
        screen.getByRole("button", { name: `Supprimer ${item.name} du panier` }),
      ).toBeInTheDocument()
    }
    // Le nom long est tronqué visuellement, mais reste lisible en entier.
    expect(screen.getByText(longName)).toHaveAttribute("title", longName)
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
    await user.click(screen.getByRole("button", { name: "Vider la vente en cours" }))
    expect(screen.getByRole("heading", { name: "Vider le panier ?" })).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Annuler" }))
    expect(callbacks.onClear).not.toHaveBeenCalled()
    await user.click(screen.getByRole("button", { name: "Vider la vente en cours" }))
    await user.click(screen.getByRole("button", { name: "Vider le panier" }))
    expect(callbacks.onClear).toHaveBeenCalledOnce()
  })

  it("suspends the current sale on demand", async () => {
    const user = userEvent.setup()
    const callbacks = renderCart([coca])
    await user.click(screen.getByRole("button", { name: /Suspendre/ }))
    expect(callbacks.onSuspend).toHaveBeenCalledOnce()
  })

  it("hides suspend and clear when the cart is empty", () => {
    renderCart([])
    expect(screen.queryByRole("button", { name: /Suspendre/ })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Vider la vente en cours" })).not.toBeInTheDocument()
  })
})
