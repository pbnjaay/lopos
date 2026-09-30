// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { CashRegister, CashSessionSummary, Store } from "../types/api"
import { ZReportTotals } from "../features/cash-session/ZReportTotals"
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
    expect(screen.getByText("Supérette Test · Caisse 01")).toBeInTheDocument()
    expect(screen.getByText("Supérette Test", { selector: ".report-identity strong" })).toBeInTheDocument()
    expect(screen.getByText("Caisse 01", { selector: ".report-identity span" })).toBeInTheDocument()
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

    await user.click(screen.getByRole("button", { name: "Imprimer le rapport" }))

    expect(printMock).toHaveBeenCalledOnce()
  })
})

describe("ZReportTotals — cahier clients", () => {
  it("separates credit, customer payments and deducted returns from money", () => {
    render(
      <ZReportTotals
        summary={{
          ...summary,
          returns_total: "10000.00",
          net_sales: "33000.00",
          refunds: { cash: "4000.00", wave: "0.00", orange_money: "0.00" },
          credit_sales: "12000.00",
          credit_returns: "6000.00",
          customer_payments: { cash: "3000.00", wave: "2000.00", orange_money: "0.00" },
          expected_cash: "29000.00",
        }}
      />,
    )

    const sales = screen.getByRole("region", { name: "Encaissements des ventes" })
    expect(within(sales).getByText("Mis au cahier").nextSibling).toHaveTextContent("12 000 FCFA")
    const refunds = screen.getByRole("region", { name: "Remboursements des retours" })
    expect(within(refunds).getByText("Déduits du cahier").nextSibling).toHaveTextContent("− 6 000 FCFA")
    const book = screen.getByRole("region", { name: "Cahier clients" })
    expect(within(book).getByText("Nouveau crédit").nextSibling).toHaveTextContent("12 000 FCFA")
    expect(within(book).getByText("Paiements clients Wave").nextSibling).toHaveTextContent("2 000 FCFA")
    const drawer = screen.getByRole("region", { name: "Espèces en caisse" })
    expect(within(drawer).getByText("+ Paiements clients en espèces").nextSibling).toHaveTextContent("3 000 FCFA")
    expect(within(drawer).getByText("− Remboursements en espèces").nextSibling).toHaveTextContent("4 000 FCFA")
    expect(within(drawer).getByText("Cash attendu").nextSibling).toHaveTextContent("29 000 FCFA")
  })

  it("stays as before for a shop that does not use the book", () => {
    render(<ZReportTotals summary={{ ...summary, credit_sales: "0.00", credit_returns: "0.00" }} />)

    expect(screen.queryByRole("region", { name: "Cahier clients" })).not.toBeInTheDocument()
    expect(screen.queryByText("Mis au cahier")).not.toBeInTheDocument()
    expect(screen.queryByText("+ Ventes en espèces")).not.toBeInTheDocument()
  })
})

describe("ZReportTotals — dépenses", () => {
  it("lists expenses by method and takes only cash ones out of the drawer", () => {
    // Fond 15 000 + ventes espèces 15 000 − dépenses espèces 5 000 = 25 000.
    render(
      <ZReportTotals
        summary={{
          ...summary,
          expenses_count: 3,
          expenses: { cash: "5000.00", wave: "7000.00", orange_money: "1000.00" },
          expected_cash: "25000.00",
        }}
      />,
    )

    const expenses = screen.getByRole("region", { name: "Dépenses" })
    expect(within(expenses).getByText("Espèces").nextSibling).toHaveTextContent("− 5 000 FCFA")
    expect(within(expenses).getByText("Wave").nextSibling).toHaveTextContent("− 7 000 FCFA")
    expect(within(expenses).getByText("Orange Money").nextSibling).toHaveTextContent("− 1 000 FCFA")
    const drawer = screen.getByRole("region", { name: "Espèces en caisse" })
    expect(within(drawer).getByText("+ Ventes en espèces").nextSibling).toHaveTextContent("15 000 FCFA")
    expect(within(drawer).getByText("− Dépenses en espèces").nextSibling).toHaveTextContent("5 000 FCFA")
    expect(within(drawer).getByText("Cash attendu").nextSibling).toHaveTextContent("25 000 FCFA")
    // Une dépense n'est jamais une vente.
    const sales = screen.getByRole("region", { name: "Ventes" })
    expect(within(sales).getByText("Ventes brutes").nextSibling).toHaveTextContent("43 000 FCFA")
  })

  it("shows no expense section when the session had none", () => {
    render(
      <ZReportTotals
        summary={{ ...summary, expenses_count: 0, expenses: { cash: "0.00", wave: "0.00", orange_money: "0.00" } }}
      />,
    )

    expect(screen.queryByRole("region", { name: "Dépenses" })).not.toBeInTheDocument()
    expect(screen.queryByText("− Dépenses en espèces")).not.toBeInTheDocument()
  })

  it("keeps the drawer detail for mobile-money-only expenses without a cash line", () => {
    render(
      <ZReportTotals
        summary={{ ...summary, expenses: { cash: "0.00", wave: "7000.00", orange_money: "0.00" } }}
      />,
    )

    expect(screen.getByRole("region", { name: "Dépenses" })).toBeInTheDocument()
    expect(screen.queryByText("− Dépenses en espèces")).not.toBeInTheDocument()
  })
})
