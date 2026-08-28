// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { afterEach, describe, expect, it, vi } from "vitest"

import { getSaleReceipt, getSaleReturn } from "../api/sales"
import type { CashSession, CurrentUser, SaleReceipt, SaleReturn } from "../types/api"
import { SaleReturnReceiptPage } from "./SaleReturnReceiptPage"

vi.mock("../api/sales", () => ({
  getSaleReceipt: vi.fn(),
  getSaleReturn: vi.fn(),
}))

const user: CurrentUser = {
  id: 7,
  username: "cashier",
  email: "",
  first_name: "Awa",
  last_name: "",
  is_staff: false,
}

const session: CashSession = {
  id: "session-id",
  cash_register_id: "register-id",
  cashier_id: user.id,
  opening_balance: "10000.00",
  status: "OPEN",
  opened_at: "2026-08-24T10:00:00Z",
  closing_balance: null,
  expected_balance: null,
  difference: null,
  closed_at: null,
}

const originalSale: SaleReceipt = {
  id: "a12f0000-0000-0000-0000-000000000000",
  created_at: "2026-08-24T12:00:00Z",
  store: { id: "store-id", name: "Boutique A" },
  cash_register: { id: "register-id", name: "Caisse 01" },
  cashier: { id: user.id, username: user.username },
  status: "COMPLETED",
  subtotal: "2000.00",
  discount: "0.00",
  total: "2000.00",
  payment: { method: "CASH", amount: "2000.00", received_amount: "2000.00", change_amount: "0.00" },
  items: [],
}

const saleReturn: SaleReturn = {
  id: "return-id",
  reference: "RET-A12F",
  original_sale_id: originalSale.id,
  total_refund: "1250.00",
  payment_method: "CASH",
  status: "COMPLETED",
  created_at: "2026-08-24T13:00:00Z",
  items: [{
    id: "return-item-id",
    product_name: "Riz",
    sale_unit: "KG",
    quantity: "1.250",
    unit_price: "1000.00",
    refund_amount: "1250.00",
    restock: true,
  }],
}

vi.mock("../features/auth/queries", () => ({ useCurrentUser: () => ({ data: user }) }))
vi.mock("../features/cash-session/queries", () => ({ usePosSession: () => ({ ownSession: session }) }))

function renderPage(initialEntry = `/returns/${saleReturn.id}/receipt`) {
  vi.mocked(getSaleReturn).mockResolvedValue(saleReturn)
  vi.mocked(getSaleReceipt).mockResolvedValue(originalSale)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/returns/:returnId/receipt" element={<SaleReturnReceiptPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("SaleReturnReceiptPage", () => {
  it("matches the sale-ticket navigation and human-readable formatting", async () => {
    const actor = userEvent.setup()
    const printMock = vi.spyOn(window, "print").mockImplementation(() => undefined)
    renderPage()

    expect(await screen.findByRole("heading", { name: "Ticket de retour" })).toBeInTheDocument()
    expect(screen.getAllByText("Ticket de retour")).toHaveLength(2)
    expect(screen.getByRole("link", { name: "Retour à la vente" })).toHaveAttribute(
      "href",
      `/sales/${originalSale.id}`,
    )
    expect(screen.getAllByText("Boutique A · Caisse 01")).toHaveLength(1)
    expect(screen.getByText("1,25 kg × 1 000 FCFA/kg")).toBeInTheDocument()
    expect(screen.getByText("Espèces")).toBeInTheDocument()

    await actor.click(screen.getByRole("button", { name: "Imprimer le ticket" }))
    expect(printMock).toHaveBeenCalledOnce()
  })

  it("opens the print dialog when requested by the inline success action", async () => {
    const printMock = vi.spyOn(window, "print").mockImplementation(() => undefined)
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0)
      return 1
    })

    renderPage(`/returns/${saleReturn.id}/receipt?print=1`)

    await screen.findByRole("heading", { name: "Ticket de retour" })
    await waitFor(() => expect(printMock).toHaveBeenCalledOnce())
  })
})
