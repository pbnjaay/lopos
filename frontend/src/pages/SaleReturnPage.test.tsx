// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { afterEach, describe, expect, it, vi } from "vitest"

import { getSaleReceipt } from "../api/sales"
import type { CashSession, CurrentUser, SaleReceipt } from "../types/api"
import { SaleReturnPage } from "./SaleReturnPage"

vi.mock("../api/sales", () => ({
  createSaleReturn: vi.fn(),
  getSaleReceipt: vi.fn(),
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

const sale: SaleReceipt = {
  id: "a12f0000-0000-0000-0000-000000000000",
  created_at: "2026-08-24T12:00:00Z",
  store: { id: "store-id", name: "Boutique A" },
  cash_register: { id: "register-id", name: "Caisse 01" },
  cashier: { id: user.id, username: user.username },
  status: "COMPLETED",
  subtotal: "2000.00",
  discount: "0.00",
  total: "2000.00",
  returned_total: "500.00",
  net_total: "1500.00",
  payment: { method: "CASH", amount: "2000.00", received_amount: "2000.00", change_amount: "0.00" },
  items: [
    { id: "item-1", product_id: "product-1", product_name: "Riz", sale_unit: "KG", unit_price: "1000.00", quantity: "2.000", quantity_returned: "0.500", quantity_returnable: "1.500", line_total: "2000.00" },
    { id: "item-2", product_id: "product-2", product_name: "Sucre", sale_unit: "UNIT", unit_price: "500.00", quantity: "1.000", quantity_returned: "1.000", quantity_returnable: "0.000", line_total: "500.00" },
  ],
}

vi.mock("../features/auth/queries", () => ({ useCurrentUser: () => ({ data: user }) }))
vi.mock("../features/cash-session/queries", () => ({ usePosSession: () => ({ ownSession: session }) }))
vi.mock("../features/offline/useNetworkStatus", () => ({ useNetworkStatus: () => true }))

function renderPage() {
  vi.mocked(getSaleReceipt).mockResolvedValue(sale)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/sales/${sale.id}/return`]}>
        <Routes><Route path="/sales/:saleId/return" element={<SaleReturnPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("SaleReturnPage", () => {
  it("uses the shared navigation and blocks unavailable or excessive quantities", async () => {
    const actor = userEvent.setup()
    renderPage()

    expect(await screen.findByRole("heading", { name: "Ticket A12F0000" })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Retour à la vente" })).toHaveAttribute("href", `/sales/${sale.id}`)
    expect(screen.getByLabelText("Quantité à retourner", { selector: "#return-quantity-item-2" })).toBeDisabled()

    const quantity = screen.getByLabelText("Quantité à retourner", { selector: "#return-quantity-item-1" })
    await actor.type(quantity, "2")
    expect(screen.getByText("La quantité dépasse le maximum retournable.")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Continuer" })).toBeDisabled()
  })
})
