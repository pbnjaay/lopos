// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"

import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { SaleResponse } from "../../types/api"
import { SaleSuccessModal } from "./SaleSuccessModal"

const sale: SaleResponse = {
  id: "sale-id",
  status: "COMPLETED",
  subtotal: "1000.00",
  discount: "0.00",
  total: "1000.00",
  payment: {
    method: "CASH",
    amount: "1000.00",
    received_amount: "2000.00",
    change_amount: "1000.00",
  },
  items: [],
  created_at: "2026-08-17T00:00:00Z",
}

afterEach(cleanup)

describe("SaleSuccessModal", () => {
  it("uses the backend amounts and starts a new sale", async () => {
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
})
