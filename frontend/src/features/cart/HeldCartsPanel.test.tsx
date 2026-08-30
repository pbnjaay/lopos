// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"

import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { LocalCart } from "../../db/types"
import { HeldCartsDialog } from "./HeldCartsPanel"
import type { CartItem } from "./cartState"

const coca: CartItem = {
  productId: "coca",
  name: "Coca 50cl",
  unitPrice: 500,
  catalogUnitPrice: 500,
  saleUnit: "UNIT",
  quantityMilli: 1000,
  stockMilli: 20_000,
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

function renderDialog(carts: LocalCart[], activeItemCount = 0) {
  const onResume = vi.fn()
  const onDelete = vi.fn()
  render(
    <HeldCartsDialog
      carts={carts}
      activeItemCount={activeItemCount}
      onClose={vi.fn()}
      onResume={onResume}
      onDelete={onDelete}
    />,
  )
  return { onResume, onDelete }
}

afterEach(cleanup)

describe("HeldCartsDialog", () => {
  it("shows an empty state when there is nothing held", () => {
    renderDialog([])
    expect(screen.getByText("Aucun panier en attente.")).toBeInTheDocument()
  })

  it("resumes a held cart directly when the active cart is empty", async () => {
    const user = userEvent.setup()
    const { onResume } = renderDialog([buildHeldCart()], 0)
    await user.click(screen.getByRole("button", { name: "Reprendre" }))
    expect(onResume).toHaveBeenCalledWith("held-1", "direct")
  })

  it("asks to hold or clear the active cart before resuming a held one", async () => {
    const user = userEvent.setup()
    const { onResume } = renderDialog([buildHeldCart()], 2)
    await user.click(screen.getByRole("button", { name: "Reprendre" }))
    expect(screen.getByRole("heading", { name: "Panier actuel non vide" })).toBeInTheDocument()
    expect(onResume).not.toHaveBeenCalled()

    await user.click(screen.getByRole("button", { name: "Mettre en attente et reprendre" }))
    expect(onResume).toHaveBeenCalledWith("held-1", "hold")
  })

  it("clears the active cart and resumes when that choice is made", async () => {
    const user = userEvent.setup()
    const { onResume } = renderDialog([buildHeldCart()], 2)
    await user.click(screen.getByRole("button", { name: "Reprendre" }))
    await user.click(screen.getByRole("button", { name: "Vider et reprendre" }))
    expect(onResume).toHaveBeenCalledWith("held-1", "clear")
  })

  it("only offers the two real choices in the footer, no separate cancel button", async () => {
    const user = userEvent.setup()
    const { onResume } = renderDialog([buildHeldCart()], 2)
    await user.click(screen.getByRole("button", { name: "Reprendre" }))
    const dialog = screen.getByRole("heading", { name: "Panier actuel non vide" }).closest("section")!
    const footerButtons = within(dialog.querySelector(".dialog-footer")!).getAllByRole("button")
    expect(footerButtons.map((button) => button.textContent)).toEqual([
      "Vider et reprendre",
      "Mettre en attente et reprendre",
    ])

    // Un seul `Dialog` monté à la fois : Échap recule vers la liste (onBack),
    // il ne ferme jamais tout le panneau depuis une étape de confirmation.
    await user.keyboard("{Escape}")
    expect(screen.queryByRole("heading", { name: "Panier actuel non vide" })).not.toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Paniers en attente" })).toBeInTheDocument()
    expect(onResume).not.toHaveBeenCalled()
  })

  it("deletes a held cart after confirmation", async () => {
    const user = userEvent.setup()
    const { onDelete } = renderDialog([buildHeldCart()])
    await user.click(screen.getByRole("button", { name: "Supprimer le panier en attente (1 article)" }))
    expect(screen.getByRole("heading", { name: "Supprimer ce panier ?" })).toBeInTheDocument()
    expect(onDelete).not.toHaveBeenCalled()
    await user.click(screen.getByRole("button", { name: "Supprimer le panier" }))
    expect(onDelete).toHaveBeenCalledWith("held-1")
  })
})
