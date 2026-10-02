// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"

import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, describe, expect, it, vi } from "vitest"

import * as approvalsApi from "../../api/approvals"
import { ApiError } from "../../api/client"
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

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

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

    it("requires a reason, then calls onCancelSale with it", async () => {
      const user = userEvent.setup()
      const onCancelSale = vi.fn().mockResolvedValue(undefined)
      render(<SaleSuccessModal sale={sale} onNewSale={vi.fn()} onCancelSale={onCancelSale} />)

      await user.click(screen.getByRole("button", { name: "Erreur ? Annuler cette vente" }))
      expect(screen.getByRole("button", { name: "Confirmer l'annulation" })).toBeDisabled()
      await user.type(screen.getByLabelText("Motif (obligatoire)"), "Mauvais article")
      await user.click(screen.getByRole("button", { name: "Confirmer l'annulation" }))

      expect(onCancelSale).toHaveBeenCalledWith({ reason: "Mauvais article", approvalToken: null })
    })

    it("keeps the confirmation open and shows the error when cancelling fails", async () => {
      const user = userEvent.setup()
      const onCancelSale = vi.fn().mockRejectedValue(
        new ApiError(409, { code: "INVALID_CANCELLATION", message: "Impossible d’annuler cette vente." }),
      )
      render(<SaleSuccessModal sale={sale} onNewSale={vi.fn()} onCancelSale={onCancelSale} />)

      await user.click(screen.getByRole("button", { name: "Erreur ? Annuler cette vente" }))
      await user.type(screen.getByLabelText("Motif (obligatoire)"), "Erreur")
      await user.click(screen.getByRole("button", { name: "Confirmer l'annulation" }))

      expect(
        screen.getByRole("heading", { name: "Annuler cette vente ?" }),
      ).toBeInTheDocument()
      expect(await screen.findByText("Impossible d’annuler cette vente.")).toBeInTheDocument()
    })

    it("asks a manager's PIN when the server requires it, then retries with the approval", async () => {
      const user = userEvent.setup()
      vi.spyOn(approvalsApi, "listApprovers").mockResolvedValue([{ id: 7, name: "Awa" }])
      const approvalSpy = vi.spyOn(approvalsApi, "requestApproval").mockResolvedValue({
        approval_token: "signed-token",
        approver: { id: 7, name: "Awa" },
      })
      const onCancelSale = vi
        .fn()
        .mockRejectedValueOnce(
          new ApiError(403, { code: "MANAGER_APPROVAL_REQUIRED", message: "Validation requise." }),
        )
        .mockResolvedValueOnce(undefined)
      render(
        <QueryClientProvider client={new QueryClient()}>
          <SaleSuccessModal
            sale={sale}
            cashSessionId="session-id"
            onNewSale={vi.fn()}
            onCancelSale={onCancelSale}
          />
        </QueryClientProvider>,
      )

      await user.click(screen.getByRole("button", { name: "Erreur ? Annuler cette vente" }))
      await user.type(screen.getByLabelText("Motif (obligatoire)"), "Client parti")
      await user.click(screen.getByRole("button", { name: "Confirmer l'annulation" }))
      expect(await screen.findByRole("heading", { name: "Un gérant doit valider" })).toBeInTheDocument()
      await screen.findByRole("option", { name: "Awa" })
      await user.type(screen.getByLabelText("Code PIN du gérant"), "4821")
      await user.click(screen.getByRole("button", { name: "Valider" }))

      expect(approvalSpy).toHaveBeenCalledWith({
        cashSessionId: "session-id",
        action: "CANCEL_SALE",
        saleId: "sale-id",
        approverId: 7,
        pin: "4821",
      })
      expect(onCancelSale).toHaveBeenLastCalledWith({
        reason: "Client parti",
        approvalToken: "signed-token",
      })
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

describe("SaleSuccessModal — vente mise au cahier", () => {
  const creditSale: ReceiptView = {
    ...sale,
    total: 10_000,
    netTotal: 10_000,
    payments: [{ method: "CASH", amount: 4_000, receivedAmount: 4_000, changeAmount: 0 }],
    creditAmount: 6_000,
    customer: { id: "moussa", name: "Moussa Fall", phone: "+221771234567" },
  }

  it("shows what was paid, what went on the book and for whom", () => {
    render(<SaleSuccessModal sale={creditSale} onNewSale={vi.fn()} onCancelSale={vi.fn()} />)

    expect(screen.getByText("Paiement").nextSibling).toHaveTextContent("Espèces — 4 000 FCFA")
    expect(screen.getByText("Mis au cahier").nextSibling).toHaveTextContent("6 000 FCFA")
    expect(screen.getByText("Client").nextSibling).toHaveTextContent("Moussa Fall")
  })

  it("warns that cancelling removes the debt from the book", async () => {
    const user = userEvent.setup()
    render(
      <SaleSuccessModal
        sale={{ ...creditSale, payments: [], creditAmount: 10_000 }}
        onNewSale={vi.fn()}
        onCancelSale={vi.fn()}
      />,
    )

    await user.click(screen.getByRole("button", { name: "Erreur ? Annuler cette vente" }))

    expect(
      screen.getByText(/La somme mise au cahier de Moussa Fall sera retirée de son solde/),
    ).toBeInTheDocument()
    expect(screen.queryByText(/Si le client a déjà payé/)).not.toBeInTheDocument()
  })
})
