// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { afterEach, describe, expect, it, vi } from "vitest"

import { currentUserQueryKey } from "../features/auth/queries"
import { SELECTED_CASH_REGISTER_KEY } from "../features/cash-session/queries"
import type { CashRegister, CashSession, CurrentUser } from "../types/api"
import { OpenCashSessionPage } from "./OpenCashSessionPage"

vi.mock("../db/sessions", () => ({
  saveLocalCashSession: vi.fn().mockResolvedValue(undefined),
}))

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

const openedSession: CashSession = {
  id: "session-id",
  cash_register_id: cashRegister.id,
  cashier_id: cashier.id,
  opening_balance: "15000.00",
  status: "OPEN",
  opened_at: "2026-08-17T16:00:00Z",
  closing_balance: null,
  expected_balance: null,
  difference: null,
  closed_at: null,
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  })
  queryClient.setQueryData(currentUserQueryKey, cashier)
  queryClient.setQueryData(["cash-registers"], [cashRegister])
  queryClient.setQueryData(
    ["cash-registers", cashRegister.id, "current-session"],
    null,
  )

  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/cash/open"]}>
        <Routes>
          <Route path="/cash/open" element={<OpenCashSessionPage />} />
          <Route path="/pos" element={<p>Caisse ouverte</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
  document.cookie = "csrftoken=; Max-Age=0; path=/"
})

describe("OpenCashSessionPage", () => {
  it("opens the selected register and redirects to the POS", async () => {
    const user = userEvent.setup()
    document.cookie = "csrftoken=test-token; path=/"
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(openedSession), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    )

    renderPage()
    expect(screen.getByLabelText("Caisse")).toHaveValue(cashRegister.id)
    await user.type(screen.getByLabelText("Fond de caisse initial"), "15 000")
    expect(screen.getByText("15 000 FCFA")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Ouvrir la caisse" }))

    expect(await screen.findByText("Caisse ouverte")).toBeInTheDocument()
    expect(localStorage.getItem(SELECTED_CASH_REGISTER_KEY)).toBe(cashRegister.id)
    const [, request] = fetchMock.mock.calls[0] ?? []
    expect(request?.body).toBe(
      JSON.stringify({
        cash_register_id: cashRegister.id,
        opening_balance: "15000.00",
      }),
    )
  })
})
