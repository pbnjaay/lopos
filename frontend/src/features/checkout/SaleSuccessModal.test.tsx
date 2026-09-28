// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"

import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { ReceiptView } from "../sales/receiptView"
import { SaleSuccessModal } from "./SaleSuccessModal"

const sale: ReceiptView = {
  id: "sale-id",
  isPendingSync: false,
  storeName: "Supérette Test",
  cashRegisterName: "Caisse 01",
  cashierName: "cashier",
  createdAt: "2026-08-17T00:00:00Z",
  total: 1_000,
  returnedTotal: 0,
  netTotal: 1_000,
  payments: [
    {
      method: "CASH",
      amount: 1_000,
      receivedAmount: 2_000,
      changeAmount: 1_000,
    },
  ],
  items: [],
}

afterEach(cleanup)

describe("SaleSuccessModal", () => {
  it("uses the sale amounts and starts a new sale", async () => {
    const user = userEvent.setup()
    const onNewSale = vi.fn()
    render(<SaleSuccessModal sale={sale} onNewSale={onNewSale} onCancelSale={vi.fn()} />)

    expect(screen.getByRole("heading", { name: "Vente validée" })).toBeInTheDocument()
    expect(screen.getByText("2 000 FCFA")).toBeInTheDocument()
    expect(screen.getAllByText("1 000 FCFA")).toHaveLength(2)
    expect(screen.getByRole("link", { name: "Imprimer le ticket" })).toHaveAttribute(
      "href",
      "/sales/sale-id/receipt?from=pos",
    )
    expect(screen.getByRole("link", { name: "Imprimer le ticket" })).not.toHaveAttribute("target")
    await user.click(screen.getByRole("button", { name: "Nouvelle vente" }))
    expect(onNewSale).toHaveBeenCalledOnce()
  })

  it("shows a local reference instead of a server number for an offline sale", () => {
    render(
      <SaleSuccessModal
        sale={{ ...sale, id: "0f9e8d7c-1234-4a5b-9c6d-abcdef012345", isPendingSync: true }}
        onNewSale={vi.fn()}
        onCancelSale={vi.fn()}
      />,
    )

    expect(screen.getByText(/Référence locale/)).toHaveTextContent("0F9E8D7C")
  })

  it("clears the completed-sale state before opening the ticket", () => {
    const onPrintTicket = vi.fn()
    render(
      <SaleSuccessModal
        sale={sale}
        onNewSale={vi.fn()}
        onPrintTicket={onPrintTicket}
        onCancelSale={vi.fn()}
      />,
    )
    const link = screen.getByRole("link", { name: "Imprimer le ticket" })
    link.addEventListener("click", (event) => event.preventDefault())

    fireEvent.click(link)

    expect(onPrintTicket).toHaveBeenCalledOnce()
  })

  it("starts a new sale with Enter", () => {
    const onNewSale = vi.fn()
    render(<SaleSuccessModal sale={sale} onNewSale={onNewSale} onCancelSale={vi.fn()} />)

    fireEvent.keyDown(window, { key: "Enter" })
    expect(onNewSale).toHaveBeenCalledOnce()
  })

  it("closes with Escape, like every other dialog, by starting the next sale", () => {
    const onNewSale = vi.fn()
    render(<SaleSuccessModal sale={sale} onNewSale={onNewSale} onCancelSale={vi.fn()} />)

    fireEvent.keyDown(window, { key: "Escape" })
    expect(onNewSale).toHaveBeenCalledOnce()
  })

  it("ignores a held-down Enter key repeat", () => {
    const onNewSale = vi.fn()
    render(<SaleSuccessModal sale={sale} onNewSale={onNewSale} onCancelSale={vi.fn()} />)

    fireEvent.keyDown(window, { key: "Enter", repeat: true })
    expect(onNewSale).not.toHaveBeenCalled()
  })

  it("puts the change to give back right under the title", () => {
    render(<SaleSuccessModal sale={sale} onNewSale={vi.fn()} onCancelSale={vi.fn()} />)

    const hero = screen.getByText("Monnaie à rendre").parentElement!
    expect(hero).toHaveTextContent("1 000 FCFA")
    expect(screen.getByRole("heading", { name: "Vente validée" }).nextElementSibling).toBe(hero)
  })

  it("shows no change block for a mobile money sale", () => {
    render(
      <SaleSuccessModal
        sale={{
          ...sale,
          payments: [{ method: "WAVE", amount: 1_000, receivedAmount: null, changeAmount: null }],
        }}
        onNewSale={vi.fn()}
        onCancelSale={vi.fn()}
      />,
    )

    expect(screen.queryByText("Monnaie à rendre")).not.toBeInTheDocument()
  })

  it("opens the cancel confirmation with Enter instead of starting a new sale", async () => {
    const user = userEvent.setup()
    const onNewSale = vi.fn()
    render(<SaleSuccessModal sale={sale} onNewSale={onNewSale} onCancelSale={vi.fn()} />)

    screen.getByRole("button", { name: "Erreur ? Annuler cette vente" }).focus()
    await user.keyboard("{Enter}")

    expect(onNewSale).not.toHaveBeenCalled()
    expect(screen.getByRole("heading", { name: "Annuler cette vente ?" })).toBeInTheDocument()
  })

  it("starts a new sale exactly once with Enter on the focused button", async () => {
    const user = userEvent.setup()
    const onNewSale = vi.fn()
    render(<SaleSuccessModal sale={sale} onNewSale={onNewSale} onCancelSale={vi.fn()} />)

    expect(screen.getByRole("button", { name: "Nouvelle vente" })).toHaveFocus()
    await user.keyboard("{Enter}")

    expect(onNewSale).toHaveBeenCalledOnce()
  })

  describe("cancelling the sale", () => {
    it("asks for confirmation before cancelling, and Enter no longer starts a new sale", async () => {
      const user = userEvent.setup()
      const onNewSale = vi.fn()
      const onCancelSale = vi.fn()
      render(<SaleSuccessModal sale={sale} onNewSale={onNewSale} onCancelSale={onCancelSale} />)

      await user.click(screen.getByRole("button", { name: "Erreur ? Annuler cette vente" }))

      expect(screen.getByRole("heading", { name: "Annuler cette vente ?" })).toBeInTheDocument()
      expect(onCancelSale).not.toHaveBeenCalled()
      fireEvent.keyDown(window, { key: "Enter" })
      expect(onNewSale).not.toHaveBeenCalled()
    })

    it("calls onCancelSale once confirmed", async () => {
      const user = userEvent.setup()
      const onCancelSale = vi.fn().mockResolvedValue(undefined)
      render(<SaleSuccessModal sale={sale} onNewSale={vi.fn()} onCancelSale={onCancelSale} />)

      await user.click(screen.getByRole("button", { name: "Erreur ? Annuler cette vente" }))
      await user.click(screen.getByRole("button", { name: "Confirmer l'annulation" }))

      expect(onCancelSale).toHaveBeenCalledOnce()
    })

    it("keeps the confirmation open and shows the error when cancelling fails", async () => {
      const user = userEvent.setup()
      const onCancelSale = vi.fn().mockRejectedValue(new Error("boom"))
      render(
        <SaleSuccessModal
          sale={sale}
          onNewSale={vi.fn()}
          onCancelSale={onCancelSale}
          cancelErrorMessage="Impossible d’annuler cette vente."
        />,
      )

      await user.click(screen.getByRole("button", { name: "Erreur ? Annuler cette vente" }))
      await user.click(screen.getByRole("button", { name: "Confirmer l'annulation" }))

      expect(
        screen.getByRole("heading", { name: "Annuler cette vente ?" }),
      ).toBeInTheDocument()
      expect(screen.getByText("Impossible d’annuler cette vente.")).toBeInTheDocument()
    })

    it("backs out without cancelling via « Garder la vente »", async () => {
      const user = userEvent.setup()
      const onCancelSale = vi.fn()
      render(<SaleSuccessModal sale={sale} onNewSale={vi.fn()} onCancelSale={onCancelSale} />)

      await user.click(screen.getByRole("button", { name: "Erreur ? Annuler cette vente" }))
      await user.click(screen.getByRole("button", { name: "Garder la vente" }))

      expect(
        screen.queryByRole("heading", { name: "Annuler cette vente ?" }),
      ).not.toBeInTheDocument()
      expect(onCancelSale).not.toHaveBeenCalled()
    })
  })
})
