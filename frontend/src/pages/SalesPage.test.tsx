// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { afterEach, describe, expect, it, vi } from "vitest"

import { listSales } from "../api/sales"
import type { CashRegister, CashSession, CurrentUser } from "../types/api"
import { SalesPage } from "./SalesPage"

vi.mock("../api/sales", () => ({ listSales: vi.fn() }))

const user: CurrentUser = {
  id: 7,
  username: "admin",
  email: "",
  first_name: "Awa",
  last_name: "",
  is_staff: true,
}

const register: CashRegister = {
  id: "register-a",
  store_id: "store-a",
  name: "Caisse A",
  is_active: true,
  created_at: "2026-08-24T10:00:00Z",
  updated_at: "2026-08-24T10:00:00Z",
}

const session: CashSession = {
  id: "session-a",
  cash_register_id: register.id,
  cashier_id: user.id,
  opening_balance: "10000.00",
  status: "OPEN",
  opened_at: "2026-08-24T10:00:00Z",
  closing_balance: null,
  expected_balance: null,
  difference: null,
  closed_at: null,
}

vi.mock("../features/auth/queries", () => ({
  useCurrentUser: () => ({ data: user }),
}))

vi.mock("../features/cash-session/queries", () => ({
  usePosSession: () => ({
    ownSession: session,
    selectedRegister: register,
    localSession: { storeName: "Boutique A" },
  }),
}))

vi.mock("../features/offline/useNetworkStatus", () => ({
  useNetworkStatus: () => true,
}))

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/sales"]}>
        <Routes>
          <Route path="/sales" element={<SalesPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("SalesPage", () => {
  it("loads only through the current open cash session and links to sale details", async () => {
    vi.mocked(listSales).mockResolvedValue({
      count: 1,
      next: null,
      previous: null,
      results: [{
        id: "a12f0000-0000-0000-0000-000000000000",
        created_at: "2026-08-24T12:00:00Z",
        store: { id: "store-a", name: "Boutique A" },
        cash_register: { id: "register-a", name: "Caisse A" },
        cashier: { id: 8, username: "collegue" },
        status: "COMPLETED",
        total: "2000.00",
        returned_total: "500.00",
        net_total: "1500.00",
        payment: { method: "WAVE", amount: "2000.00", received_amount: null, change_amount: null },
      }],
    })

    renderPage()

    expect(screen.getByRole("link", { name: "Retour au point de vente" })).toHaveAttribute("href", "/pos")
    expect(await screen.findByRole("link", { name: /Ticket A12F0000/ })).toHaveAttribute(
      "href",
      "/sales/a12f0000-0000-0000-0000-000000000000",
    )
    expect(screen.getByText("Boutique A · Caisse A")).toBeInTheDocument()
    expect(screen.getByText("Retour : − 500 FCFA")).toBeInTheDocument()
    await waitFor(() => expect(listSales).toHaveBeenCalledWith(expect.objectContaining({ cashSessionId: "session-a" })))
  })

  it("shows numbered pagination and loads the selected page", async () => {
    const userEvents = userEvent.setup()
    vi.mocked(listSales).mockResolvedValue({
      count: 200,
      next: "/api/v1/sales/?page=2",
      previous: null,
      results: [{
        id: "a12f0000-0000-0000-0000-000000000000",
        created_at: "2026-08-24T12:00:00Z",
        store: { id: "store-a", name: "Boutique A" },
        cash_register: { id: "register-a", name: "Caisse A" },
        cashier: { id: 8, username: "collegue" },
        status: "COMPLETED",
        total: "2000.00",
        returned_total: "0.00",
        net_total: "2000.00",
        payment: { method: "CASH", amount: "2000.00", received_amount: "2000.00", change_amount: "0.00" },
      }],
    })

    renderPage()

    const pagination = await screen.findByRole("navigation", { name: "Pagination des ventes" })
    expect(screen.getByRole("button", { name: "Page précédente" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Page 1" })).toHaveAttribute("aria-current", "page")
    expect(screen.getByRole("button", { name: "Page 10" })).toBeInTheDocument()
    expect(pagination).toHaveTextContent("…")

    await userEvents.click(screen.getByRole("button", { name: "Page 5" }))

    await waitFor(() => expect(listSales).toHaveBeenCalledWith(expect.objectContaining({
      page: 5,
      pageSize: 20,
    })))
    expect(screen.getByRole("button", { name: "Page 5" })).toHaveAttribute("aria-current", "page")
  })
})
