// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { CustomerPayment } from "../types/api"
import { CustomerPaymentReceiptPage } from "./CustomerPaymentReceiptPage"

const payment: CustomerPayment = {
  id: "pay-1",
  reference: "RMB-1A2B3C4D",
  customer: { id: "moussa", name: "Moussa Fall", phone: "+221771234567" },
  store: { id: "store-id", name: "Supérette Test" },
  cash_register: { id: "register-id", name: "Caisse 01" },
  cash_session_id: "session-id",
  method: "CASH",
  amount: "4000.00",
  received_amount: "5000.00",
  change_amount: "1000.00",
  balance_before: "10000.00",
  balance_after: "6000.00",
  created_by: "caissier",
  created_at: "2026-09-28T15:00:00Z",
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("CustomerPaymentReceiptPage", () => {
  it("prints what was paid, how, and what is still owed", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(payment), { status: 200, headers: { "Content-Type": "application/json" } }),
    )
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={["/customer-payments/pay-1/receipt?cash_session_id=session-id"]}>
          <Routes>
            <Route path="/customer-payments/:paymentId/receipt" element={<CustomerPaymentReceiptPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    const receipt = await screen.findByRole("article", { name: "Reçu de paiement" })
    expect(receipt).toHaveTextContent("RMB-1A2B3C4D")
    expect(receipt).toHaveTextContent("Client : Moussa Fall · 77 ••• •• 67")
    expect(screen.getByText("Montant payé").nextSibling).toHaveTextContent("4 000 FCFA")
    expect(screen.getByText("Paiement").nextSibling).toHaveTextContent("Espèces")
    expect(screen.getByText("Monnaie").nextSibling).toHaveTextContent("1 000 FCFA")
    expect(screen.getByText("Ancien solde").nextSibling).toHaveTextContent("10 000 FCFA")
    expect(screen.getByText("Nouveau solde").nextSibling).toHaveTextContent("6 000 FCFA")
    expect(String(fetchMock.mock.calls[0]![0])).toContain("customer-payments/pay-1/?cash_session_id=session-id")
  })
})
