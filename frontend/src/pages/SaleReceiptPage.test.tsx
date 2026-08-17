// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { SaleReceipt } from "../types/api"
import { SaleReceiptPage } from "./SaleReceiptPage"

const cashReceipt: SaleReceipt = {
  id: "sale-id",
  created_at: "2026-08-17T14:32:00Z",
  store: { id: "store-id", name: "Supérette Test" },
  cash_register: { id: "register-id", name: "Caisse 01" },
  cashier: { id: 7, username: "cashier" },
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
  items: [
    {
      product_id: "product-id",
      product_name: "Coca 50cl",
      unit_price: "500.00",
      quantity: 2,
      line_total: "1000.00",
    },
  ],
}

function renderReceipt(receipt: SaleReceipt) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  queryClient.setQueryData(["sales", receipt.id, "receipt"], receipt)

  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/sales/${receipt.id}/receipt`]}>
        <Routes>
          <Route path="/sales/:saleId/receipt" element={<SaleReceiptPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("SaleReceiptPage", () => {
  it("renders historical cash sale data and prints it", async () => {
    const user = userEvent.setup()
    const printMock = vi.spyOn(window, "print").mockImplementation(() => undefined)
    renderReceipt(cashReceipt)

    expect(screen.getByRole("heading", { name: "Supérette Test" })).toBeInTheDocument()
    expect(screen.getByText("Coca 50cl")).toBeInTheDocument()
    expect(screen.getByText("2 × 500 FCFA")).toBeInTheDocument()
    expect(screen.getAllByText("1 000 FCFA")).toHaveLength(3)
    expect(screen.getByText("2 000 FCFA")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Imprimer" }))
    expect(printMock).toHaveBeenCalledOnce()
  })

  it("does not show received cash or change for mobile money", () => {
    renderReceipt({
      ...cashReceipt,
      payment: {
        method: "WAVE",
        amount: "1000.00",
        received_amount: null,
        change_amount: null,
      },
    })

    expect(screen.getByText("Wave")).toBeInTheDocument()
    expect(screen.queryByText("Reçu")).not.toBeInTheDocument()
    expect(screen.queryByText("Monnaie")).not.toBeInTheDocument()
  })
})
