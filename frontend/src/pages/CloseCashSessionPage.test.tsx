// @vitest-environment jsdom

import "fake-indexeddb/auto"
import "@testing-library/jest-dom/vitest"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { afterEach, describe, expect, it, vi } from "vitest"

import { db } from "../db/database"
import { currentUserQueryKey } from "../features/auth/queries"
import { SELECTED_CASH_REGISTER_KEY } from "../features/cash-session/queries"
import type {
  CashRegister,
  CashSession,
  CashSessionSummary,
  CurrentUser,
} from "../types/api"
import { CloseCashSessionPage } from "./CloseCashSessionPage"

vi.mock("../db/sessions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db/sessions")>()
  return {
    ...actual,
    getLocalCashSessionForRegister: vi.fn().mockResolvedValue(null),
    markLocalCashSessionClosed: vi.fn().mockResolvedValue(undefined),
  }
})

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

function renderPage(pendingLocalSalesCount = 0) {
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
  queryClient.setQueryData(
    ["pending-local-sales-for-session", session.id],
    pendingLocalSalesCount,
  )
  localStorage.setItem(SELECTED_CASH_REGISTER_KEY, cashRegister.id)

  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <CloseCashSessionPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )

  return queryClient
}

afterEach(async () => {
  cleanup()
  vi.restoreAllMocks()
  localStorage.clear()
  document.cookie = "csrftoken=; Max-Age=0; path=/"
  await db.localSales.clear()
})

describe("CloseCashSessionPage", () => {
  it("shows the session totals without revealing expected cash", () => {
    renderPage()

    expect(screen.getByRole("link", { name: "Retour au point de vente" })).toHaveAttribute("href", "/pos")
    expect(screen.getByText("3")).toBeInTheDocument()
    expect(screen.getByText("43 000 FCFA")).toBeInTheDocument()
    expect(screen.getAllByText("15 000 FCFA")).toHaveLength(2)
    expect(screen.getByText("20 000 FCFA")).toBeInTheDocument()
    expect(screen.getByText("8 000 FCFA")).toBeInTheDocument()
    expect(screen.queryByText("30 000 FCFA")).not.toBeInTheDocument()
    expect(screen.queryByText(/Cash attendu/i)).not.toBeInTheDocument()
  })

  it("formats a valid counted amount and rejects a negative value", async () => {
    const user = userEvent.setup()
    renderPage()
    const input = screen.getByLabelText("Montant compté")

    await user.type(input, "29 500")
    expect(screen.getByText("29 500 FCFA")).toBeInTheDocument()
    expect(input).toHaveAttribute("aria-invalid", "false")

    await user.clear(input)
    await user.type(input, "-1")
    expect(input).toHaveAttribute("aria-invalid", "true")
    expect(screen.getByText("Saisissez un montant positif ou nul, sans décimales.")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Vérifier la clôture" })).toBeDisabled()
  })

  it("asks for confirmation and submits the close request only once", async () => {
    const user = userEvent.setup()
    document.cookie = "csrftoken=test-token; path=/"
    const closedSummary: CashSessionSummary = {
      ...summary,
      status: "CLOSED",
      counted_cash: "29500.00",
      cash_difference: "-500.00",
      closed_at: "2026-08-17T18:00:00Z",
    }
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(closedSummary), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    )
    const queryClient = renderPage()

    await user.type(screen.getByLabelText("Montant compté"), "29 500")
    await user.click(screen.getByRole("button", { name: "Vérifier la clôture" }))
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Après cette opération, aucune nouvelle vente ne pourra être enregistrée",
    )

    await user.dblClick(screen.getByRole("button", { name: "Confirmer la clôture" }))

    expect(await screen.findByRole("heading", { name: "Caisse clôturée" })).toBeInTheDocument()
    expect(screen.getByText("Cash attendu")).toBeInTheDocument()
    expect(screen.getByText("30 000 FCFA")).toBeInTheDocument()
    expect(screen.getByText("Cash compté")).toBeInTheDocument()
    expect(screen.getByText("29 500 FCFA")).toBeInTheDocument()
    expect(screen.getByText("Manque : 500 FCFA")).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, request] = fetchMock.mock.calls[0] ?? []
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/v1/cash-sessions/session-id/close/",
    )
    expect(JSON.parse(String(request?.body))).toEqual({ counted_cash: "29500.00" })

    await user.click(screen.getByRole("button", { name: "Terminer" }))
    expect(
      queryClient.getQueryData(["cash-registers", cashRegister.id, "current-session"]),
    ).toBeNull()
  })

  it("keeps the confirmation open and shows a closing business error", async () => {
    const user = userEvent.setup()
    document.cookie = "csrftoken=test-token; path=/"
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          code: "CASH_SESSION_ALREADY_CLOSED",
          message: "Cette session de caisse est déjà clôturée.",
        }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      ),
    )
    renderPage()

    await user.type(screen.getByLabelText("Montant compté"), "29 500")
    await user.click(screen.getByRole("button", { name: "Vérifier la clôture" }))
    await user.click(screen.getByRole("button", { name: "Confirmer la clôture" }))

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Cette session de caisse est déjà clôturée.",
    )
    expect(screen.getByRole("dialog")).toHaveTextContent("Montant compté : 29 500 FCFA")
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it("shows the shared connection error without retrying the close automatically", async () => {
    const user = userEvent.setup()
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"))
    renderPage()

    await user.type(screen.getByLabelText("Montant compté"), "29 500")
    await user.click(screen.getByRole("button", { name: "Vérifier la clôture" }))
    await user.click(screen.getByRole("button", { name: "Confirmer la clôture" }))

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Impossible de joindre le serveur. Vérifiez votre connexion Internet.",
    )
    expect(globalThis.fetch).toHaveBeenCalledOnce()
  })

  it("blocks closing while sales from this session are still unsynced", async () => {
    renderPage(2)

    expect(
      await screen.findByText(
        "2 ventes de cette session n'ont pas encore été synchronisées avec le serveur. Reconnectez-vous à Internet pour synchroniser avant de clôturer.",
      ),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText("Montant compté")).not.toBeInTheDocument()
  })
})
