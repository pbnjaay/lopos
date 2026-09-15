// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { afterEach, describe, expect, it, vi } from "vitest"

import { cancelSale, getSaleReceipt } from "../api/sales"
import { ToastProvider } from "../components/ui/Toast"
import type { CashSession, CurrentUser, SaleReceipt } from "../types/api"
import { SaleDetailPage } from "./SaleDetailPage"

vi.mock("../api/sales", () => ({
  cancelSale: vi.fn(),
  getSaleReceipt: vi.fn(),
}))

const cashier: CurrentUser = {
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
  cashier_id: cashier.id,
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
  cashier: { id: cashier.id, username: cashier.username },
  status: "COMPLETED",
  subtotal: "2000.00",
  discount: "0.00",
  total: "2000.00",
  returned_total: "0.00",
  net_total: "2000.00",
  payment: { method: "CASH", amount: "2000.00", received_amount: "2000.00", change_amount: "0.00" },
  items: [
    { id: "item-1", product_id: "product-1", product_name: "Riz", sale_unit: "KG", unit_price: "1000.00", quantity: "2.000", quantity_returned: "0.000", quantity_returnable: "2.000", line_total: "2000.00" },
  ],
}

let currentUser: CurrentUser = cashier

vi.mock("../features/auth/queries", () => ({ useCurrentUser: () => ({ data: currentUser }) }))
vi.mock("../features/cash-session/queries", () => ({ usePosSession: () => ({ ownSession: session }) }))
vi.mock("../features/offline/useNetworkStatus", () => ({ useNetworkStatus: () => true }))

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={[`/sales/${sale.id}`]}>
          <Routes><Route path="/sales/:saleId" element={<SaleDetailPage />} /></Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  currentUser = cashier
})

describe("SaleDetailPage — cancelling a sale", () => {
  it("lets the sale's own cashier cancel it, after confirming", async () => {
    const actor = userEvent.setup()
    vi.mocked(getSaleReceipt).mockResolvedValue(sale)
    vi.mocked(cancelSale).mockResolvedValue({ ...sale, status: "CANCELLED" })
    renderPage()

    await actor.click(await screen.findByRole("button", { name: /Annuler la vente/ }))
    expect(screen.getByRole("heading", { name: "Annuler cette vente ?" })).toBeInTheDocument()
    await actor.click(screen.getByRole("button", { name: "Confirmer l'annulation" }))

    expect(cancelSale).toHaveBeenCalledWith(sale.id)
    expect(await screen.findByText("Annulée")).toBeInTheDocument()
    expect(
      screen.getByText("Cette vente a été annulée — son stock a été restitué."),
    ).toBeInTheDocument()
  })

  it("does not offer to cancel another cashier's sale", async () => {
    currentUser = { ...cashier, id: 999, username: "other-cashier" }
    vi.mocked(getSaleReceipt).mockResolvedValue(sale)
    renderPage()

    await screen.findByRole("heading", { name: "Ticket A12F0000" })
    expect(screen.queryByRole("button", { name: /Annuler la vente/ })).not.toBeInTheDocument()
  })

  it("does not offer to cancel a sale that is already cancelled", async () => {
    vi.mocked(getSaleReceipt).mockResolvedValue({ ...sale, status: "CANCELLED" })
    renderPage()

    await screen.findByRole("heading", { name: "Ticket A12F0000" })
    expect(screen.queryByRole("button", { name: /Annuler la vente/ })).not.toBeInTheDocument()
  })

  it("backs out via « Garder la vente » without cancelling", async () => {
    const actor = userEvent.setup()
    vi.mocked(getSaleReceipt).mockResolvedValue(sale)
    renderPage()

    await actor.click(await screen.findByRole("button", { name: /Annuler la vente/ }))
    await actor.click(screen.getByRole("button", { name: "Garder la vente" }))

    expect(cancelSale).not.toHaveBeenCalled()
    expect(
      screen.queryByRole("heading", { name: "Annuler cette vente ?" }),
    ).not.toBeInTheDocument()
  })
})
