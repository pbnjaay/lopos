// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { afterEach, describe, expect, it, vi } from "vitest"

import { currentUserQueryKey } from "../features/auth/queries"
import { SELECTED_CASH_REGISTER_KEY } from "../features/cash-session/queries"
import type {
  CashRegister,
  CashSession,
  CashSessionSummary,
  CurrentUser,
} from "../types/api"
import { CloseCashSessionPage } from "./CloseCashSessionPage"

const cashier: CurrentUser = {
  id: 7,
  username: "cashier",
  email: "",
  first_name: "Awa",
  last_name: "Diop",
  is_staff: false,
}

const cashRegister: CashRegister = {
  id: "register-id",
  store_id: "store-id",
  name: "Caisse 01",
  is_active: true,
  created_at: "2026-08-17T00:00:00Z",
  updated_at: "2026-08-17T00:00:00Z",
}

const session: CashSession = {
  id: "session-id",
  cash_register_id: cashRegister.id,
  cashier_id: cashier.id,
  opening_balance: "15000.00",
  status: "OPEN",
  opened_at: "2026-08-17T08:02:00Z",
  closing_balance: null,
  expected_balance: null,
  difference: null,
  closed_at: null,
}

const summary: CashSessionSummary = {
  id: session.id,
  status: "OPEN",
  cash_register: { id: cashRegister.id, name: cashRegister.name },
  cashier: { id: cashier.id, username: cashier.username },
  opened_at: session.opened_at,
  sales_count: 3,
  gross_sales: "43000.00",
  payments: {
    cash: "15000.00",
    wave: "20000.00",
    orange_money: "8000.00",
  },
  opening_balance: "15000.00",
  expected_cash: "30000.00",
  counted_cash: null,
  cash_difference: null,
  closed_at: null,
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  queryClient.setQueryData(currentUserQueryKey, cashier)
  queryClient.setQueryData(["cash-registers"], [cashRegister])
  queryClient.setQueryData(
    ["cash-registers", cashRegister.id, "current-session"],
    session,
  )
  queryClient.setQueryData(["cash-sessions", session.id, "summary"], summary)
  localStorage.setItem(SELECTED_CASH_REGISTER_KEY, cashRegister.id)

  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <CloseCashSessionPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})

describe("CloseCashSessionPage", () => {
  it("shows the session totals without revealing expected cash", () => {
    renderPage()

    expect(screen.getByText("3")).toBeInTheDocument()
    expect(screen.getByText("43 000 FCFA")).toBeInTheDocument()
    expect(screen.getAllByText("15 000 FCFA")).toHaveLength(2)
    expect(screen.getByText("20 000 FCFA")).toBeInTheDocument()
    expect(screen.getByText("8 000 FCFA")).toBeInTheDocument()
    expect(screen.queryByText("30 000 FCFA")).not.toBeInTheDocument()
    expect(screen.queryByText(/Cash attendu/i)).not.toBeInTheDocument()
  })
})
