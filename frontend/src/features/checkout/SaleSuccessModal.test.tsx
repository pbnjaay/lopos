// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"

import { cleanup, render, screen } from "@testing-library/react"
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
  payment: {
    method: "CASH",
    receivedAmount: 2_000,
    changeAmount: 1_000,
  },
  items: [],
}

afterEach(cleanup)

describe("SaleSuccessModal", () => {
  it("uses the sale amounts and starts a new sale", async () => {
    const user = userEvent.setup()
    const onNewSale = vi.fn()
    render(<SaleSuccessModal sale={sale} onNewSale={onNewSale} />)

    expect(screen.getByRole("heading", { name: "Vente validée" })).toBeInTheDocument()
    expect(screen.getByText("2 000 FCFA")).toBeInTheDocument()
    expect(screen.getAllByText("1 000 FCFA")).toHaveLength(2)
    expect(screen.getByRole("link", { name: "Imprimer le ticket" })).toHaveAttribute(
      "href",
      "/sales/sale-id/receipt",
    )
    expect(screen.getByRole("link", { name: "Imprimer le ticket" })).toHaveAttribute(
      "target",
      "_blank",
    )
    await user.click(screen.getByRole("button", { name: "Nouvelle vente" }))
    expect(onNewSale).toHaveBeenCalledOnce()
  })

  it("shows a local reference instead of a server number for an offline sale", () => {
    render(
      <SaleSuccessModal
        sale={{ ...sale, id: "0f9e8d7c-1234-4a5b-9c6d-abcdef012345", isPendingSync: true }}
        onNewSale={vi.fn()}
      />,
    )

    expect(screen.getByText(/Vente enregistrée hors ligne/)).toHaveTextContent("0F9E8D7C")
  })
})
