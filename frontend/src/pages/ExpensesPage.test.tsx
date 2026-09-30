// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ToastProvider } from "../components/ui/Toast"
import type {
  CashRegister,
  CashSession,
  CurrentUser,
  Expense,
  ExpenseCategory,
  PaginatedExpenses,
} from "../types/api"
import { ExpensesPage } from "./ExpensesPage"

const network = vi.hoisted(() => ({ online: true }))

const user: CurrentUser = {
  id: 7, username: "caissier", email: "", first_name: "Awa", last_name: "", is_staff: false,
}
const register: CashRegister = {
  id: "register-id", store_id: "store-id", name: "Caisse 01", is_active: true,
  created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z",
}
const session: CashSession = {
  id: "session-id", cash_register_id: register.id, cashier_id: user.id, opening_balance: "0.00",
  status: "OPEN", opened_at: "2026-09-28T08:00:00Z", closing_balance: null, expected_balance: null,
  difference: null, closed_at: null,
}

vi.mock("../features/auth/queries", () => ({ useCurrentUser: () => ({ data: user }) }))
vi.mock("../features/cash-session/queries", () => ({
  usePosSession: () => ({
    ownSession: session,
    selectedRegister: register,
    localSession: { storeName: "Supérette Test" },
  }),
}))
vi.mock("../features/offline/useNetworkStatus", () => ({ useNetworkStatus: () => network.online }))

const categories: ExpenseCategory[] = [
  { id: "electricite", name: "Électricité", requires_description: false },
  { id: "transport", name: "Transport", requires_description: false },
  { id: "autre", name: "Autre", requires_description: true },
]

function expense(overrides: Partial<Expense> = {}): Expense {
  return {
    id: "expense-id",
    reference: "DEP-1A2B3C4D",
    category: categories[0]!,
    amount: "25000.00",
    payment_method: "CASH",
    description: "Facture août",
    document_reference: "",
    status: "POSTED",
    store: { id: "store-id", name: "Supérette Test" },
    cash_register: { id: "register-id", name: "Caisse 01" },
    cash_session_id: "session-id",
    occurred_at: new Date().toISOString(),
    created_by: "caissier",
    cancelled_at: null,
    cancelled_by: null,
    cancellation_reason: "",
    can_cancel: true,
    ...overrides,
  }
}

function page(results: Expense[], totals: Partial<PaginatedExpenses["totals"]> = {}): PaginatedExpenses {
  return {
    count: results.length,
    next: null,
    previous: null,
    results,
    totals: { count: results.length, total: "0.00", cash: "0.00", wave: "0.00", orange_money: "0.00", ...totals },
  }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

type Route = (url: URL, init?: RequestInit) => Response | undefined

/** Répond selon le chemin de l'API ; toute requête imprévue échoue le test. */
function mockApi(route: Route) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input), "http://localhost")
    if (url.pathname.endsWith("/expense-categories/")) return jsonResponse(categories)
    const response = route(url, init)
    if (!response) throw new Error(`Requête inattendue : ${url.pathname}`)
    return response
  })
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={["/expenses"]}>
          <Routes>
            <Route path="/expenses" element={<ExpensesPage />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  network.online = true
})

describe("ExpensesPage", () => {
  it("lists today's expenses with the server totals, cancelled ones included but not counted", async () => {
    const fetchMock = mockApi((url) =>
      url.pathname.endsWith("/expenses/")
        ? jsonResponse({
            ...page(
              [
                expense(),
                expense({
                  id: "cancelled",
                  category: categories[1]!,
                  amount: "3000.00",
                  payment_method: "WAVE",
                  description: "",
                  status: "CANCELLED",
                }),
              ],
              { count: 1, total: "25000.00", cash: "25000.00" },
            ),
          })
        : undefined,
    )

    renderPage()

    const list = await screen.findByRole("region", { name: "Dépenses de la boutique" })
    expect(within(list).getByText("Électricité")).toBeInTheDocument()
    expect(within(list).getByText("Facture août")).toBeInTheDocument()
    expect(within(list).getByText("Annulée")).toBeInTheDocument()
    expect(within(list).getAllByRole("link")[0]).toHaveAttribute("href", "/expenses/expense-id")
    const summary = screen.getByRole("status", { name: "Dépenses de la période" })
    expect(summary).toHaveTextContent("1 dépense · 1 annulée")
    expect(summary).toHaveTextContent("25 000 FCFA")

    const listCall = fetchMock.mock.calls
      .map(([input]) => new URL(String(input), "http://localhost"))
      .find((url) => url.pathname.endsWith("/expenses/"))!
    expect(listCall.searchParams.get("cash_session_id")).toBe("session-id")
    expect(listCall.searchParams.get("date_from")).toBe(listCall.searchParams.get("date_to"))
  })

  it("filters by payment method and category", async () => {
    const fetchMock = mockApi((url) =>
      url.pathname.endsWith("/expenses/") ? jsonResponse(page([])) : undefined,
    )
    const userEvents = userEvent.setup()
    renderPage()
    await screen.findByText("Aucune dépense sur cette période")

    await userEvents.click(screen.getByRole("radio", { name: "Wave" }))
    await userEvents.selectOptions(screen.getByLabelText("Catégorie"), "transport")
    await userEvents.click(screen.getByRole("radio", { name: "7 jours" }))

    await waitFor(() => {
      const last = new URL(String(fetchMock.mock.calls.at(-1)![0]), "http://localhost")
      expect(last.searchParams.get("payment_method")).toBe("WAVE")
      expect(last.searchParams.get("category_id")).toBe("transport")
      expect(last.searchParams.get("date_from")).not.toBe(last.searchParams.get("date_to"))
    })
  })

  it("records a new expense, confirms it briefly and refreshes the list", async () => {
    let created = false
    const fetchMock = mockApi((url, init) => {
      if (url.pathname.endsWith("/expenses/") && init?.method === "POST") {
        created = true
        return jsonResponse(expense({ amount: "15000.00" }), 201)
      }
      if (url.pathname.endsWith("/expenses/")) {
        return jsonResponse(created ? page([expense({ amount: "15000.00" })], { total: "15000.00" }) : page([]))
      }
      return undefined
    })
    const userEvents = userEvent.setup()
    renderPage()
    await screen.findByText("Aucune dépense sur cette période")

    await userEvents.click(screen.getByRole("button", { name: "Nouvelle dépense" }))
    const dialog = await screen.findByRole("dialog", { name: "Nouvelle dépense" })
    await userEvents.type(within(dialog).getByLabelText("Montant"), "15000")
    await userEvents.click(await within(dialog).findByRole("radio", { name: "Électricité" }))
    await userEvents.click(within(dialog).getByRole("button", { name: "Enregistrer" }))

    expect(await screen.findByText("Dépense enregistrée")).toBeInTheDocument()
    expect(screen.getByText("15 000 FCFA · Électricité")).toBeInTheDocument()
    expect(screen.queryByRole("dialog", { name: "Nouvelle dépense" })).not.toBeInTheDocument()
    expect(await screen.findByRole("region", { name: "Dépenses de la boutique" })).toBeInTheDocument()

    const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST")!
    expect(JSON.parse(String(post[1]!.body))).toMatchObject({
      cash_session_id: "session-id",
      category_id: "electricite",
      payment_method: "CASH",
      amount: "15000.00",
    })
  })

  it("explains that expenses need a connection when offline", () => {
    network.online = false
    const fetchMock = vi.spyOn(globalThis, "fetch")

    renderPage()

    expect(screen.getByText(/s’enregistrent et se consultent en ligne/)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Nouvelle dépense" })).not.toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
