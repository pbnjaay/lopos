// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { CashRegister, CashSessionSummary, Store } from "../types/api"
import { CashSessionReportPage } from "./CashSessionReportPage"

const summary: CashSessionSummary = {
  id: "session-id",
  status: "CLOSED",
  cash_register: { id: "register-id", name: "Caisse 01" },
  cashier: { id: 7, username: "cashier" },
  opened_at: "2026-08-17T08:02:00Z",
  closed_at: "2026-08-17T18:00:00Z",
  sales_count: 3,
  gross_sales: "43000.00",
  payments: { cash: "15000.00", wave: "20000.00", orange_money: "8000.00" },
  opening_balance: "15000.00",
  expected_cash: "30000.00",
  counted_cash: "29500.00",
  cash_difference: "-500.00",
}

const cashRegister: CashRegister = {
  id: "register-id",
  store_id: "store-id",
  name: "Caisse 01",
  is_active: true,
  created_at: "2026-08-17T00:00:00Z",
  updated_at: "2026-08-17T00:00:00Z",
}

const store: Store = {
  id: "store-id",
  name: "Supérette Test",
  address: null,
  is_active: true,
  created_at: "2026-08-17T00:00:00Z",
  updated_at: "2026-08-17T00:00:00Z",
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("CashSessionReportPage", () => {
  it("renders a closed session report directly from its URL", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    })
    queryClient.setQueryData(["cash-sessions", summary.id, "summary"], summary)
    queryClient.setQueryData(["cash-registers", cashRegister.id], cashRegister)
    queryClient.setQueryData(
      ["cash-registers", cashRegister.id, "current-session"],
      { id: summary.id, status: "OPEN" },
    )
    queryClient.setQueryData(["stores", store.id], store)

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/cash-sessions/${summary.id}/report`]}>
          <Routes>
            <Route
              path="/cash-sessions/:sessionId/report"
              element={<CashSessionReportPage />}
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(screen.getByRole("heading", { name: "Rapport Z" })).toBeInTheDocument()
    expect(screen.getByText("Supérette Test")).toBeInTheDocument()
    expect(screen.getByText("Caisse 01")).toBeInTheDocument()
    expect(screen.getByText("43 000 FCFA")).toBeInTheDocument()
    expect(screen.getByText("30 000 FCFA")).toBeInTheDocument()
    expect(screen.getByText("29 500 FCFA")).toBeInTheDocument()
    expect(screen.getByText("Manque : 500 FCFA")).toBeInTheDocument()
    await waitFor(() =>
      expect(
        queryClient.getQueryData([
          "cash-registers",
          cashRegister.id,
          "current-session",
        ]),
      ).toBeNull(),
    )
  })

  it("opens the browser print dialog without calling the API", async () => {
    const user = userEvent.setup()
    const printMock = vi.spyOn(window, "print").mockImplementation(() => undefined)
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    })
    queryClient.setQueryData(["cash-sessions", summary.id, "summary"], summary)
    queryClient.setQueryData(["cash-registers", cashRegister.id], cashRegister)
    queryClient.setQueryData(["stores", store.id], store)

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/cash-sessions/${summary.id}/report`]}>
          <Routes>
            <Route
              path="/cash-sessions/:sessionId/report"
              element={<CashSessionReportPage />}
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await user.click(screen.getByRole("button", { name: "Imprimer" }))

    expect(printMock).toHaveBeenCalledOnce()
  })
})
