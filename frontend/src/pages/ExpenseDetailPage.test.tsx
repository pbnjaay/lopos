// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ToastProvider } from "../components/ui/Toast"
import type { Expense } from "../types/api"
import { ExpenseDetailPage } from "./ExpenseDetailPage"

const network = vi.hoisted(() => ({ online: true }))
vi.mock("../features/offline/useNetworkStatus", () => ({ useNetworkStatus: () => network.online }))

function expense(overrides: Partial<Expense> = {}): Expense {
  return {
    id: "expense-id",
    reference: "DEP-1A2B3C4D",
    category: { id: "electricite", name: "Électricité", requires_description: false },
    amount: "25000.00",
    payment_method: "CASH",
    description: "Facture août",
    document_reference: "SENELEC-0825",
    status: "POSTED",
    store: { id: "store-id", name: "Supérette Test" },
    cash_register: { id: "register-id", name: "Caisse 01" },
    cash_session_id: "session-id",
    occurred_at: "2026-09-29T10:00:00Z",
    created_by: "caissier",
    cancelled_at: null,
    cancelled_by: null,
    cancellation_reason: "",
    can_cancel: true,
    ...overrides,
  }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={["/expenses/expense-id"]}>
          <Routes>
            <Route path="/expenses/:expenseId" element={<ExpenseDetailPage />} />
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

describe("ExpenseDetailPage", () => {
  it("shows who, when, why and how", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(expense()))

    renderPage()

    expect(await screen.findByRole("heading", { name: "Électricité" })).toBeInTheDocument()
    expect(screen.getByText(/Supérette Test · Caisse 01 · DEP-1A2B3C4D/)).toBeInTheDocument()
    const info = screen.getByLabelText("Informations de la dépense")
    expect(within(info).getByText("caissier")).toBeInTheDocument()
    expect(within(info).getByText("Espèces")).toBeInTheDocument()
    expect(within(info).getByText("Facture août")).toBeInTheDocument()
    expect(within(info).getByText("SENELEC-0825")).toBeInTheDocument()
    expect(screen.getByLabelText("Montant de la dépense")).toHaveTextContent("25 000 FCFA")
    expect(screen.getByText(/déduit des espèces attendues/)).toBeInTheDocument()
  })

  it("offers cancellation only when the server says it can succeed", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(expense({ can_cancel: false })))

    renderPage()

    await screen.findByRole("heading", { name: "Électricité" })
    expect(screen.queryByRole("button", { name: "Annuler la dépense" })).not.toBeInTheDocument()
  })

  it("cancels with a mandatory reason and shows the expense crossed out", async () => {
    const cancelledExpense = expense({
      status: "CANCELLED",
      can_cancel: false,
      cancelled_at: "2026-09-29T11:00:00Z",
      cancelled_by: "caissier",
      cancellation_reason: "Saisie en double",
    })
    let cancelled = false
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      if (init?.method === "POST") cancelled = true
      return jsonResponse(cancelled ? cancelledExpense : expense())
    })
    const userEvents = userEvent.setup()
    renderPage()

    await userEvents.click(await screen.findByRole("button", { name: "Annuler la dépense" }))
    const dialog = screen.getByRole("dialog", { name: "Annuler cette dépense ?" })
    expect(within(dialog).getByText(/revient dans les espèces attendues/)).toBeInTheDocument()
    expect(within(dialog).getByLabelText("Motif")).toHaveFocus()

    await userEvents.click(within(dialog).getByRole("button", { name: "Annuler la dépense" }))
    expect(within(dialog).getByText("Indiquez pourquoi cette dépense est annulée.")).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false)

    await userEvents.type(within(dialog).getByLabelText("Motif"), "  Saisie en double ")
    await userEvents.click(within(dialog).getByRole("button", { name: "Annuler la dépense" }))

    expect(await screen.findByText("Dépense annulée", { selector: ".toast strong" })).toBeInTheDocument()
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(screen.getByText(/Saisie en double/)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Annuler la dépense" })).not.toBeInTheDocument()
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST")!
    expect(String(post[0])).toContain("/expenses/expense-id/cancel/")
    expect(JSON.parse(String(post[1]!.body))).toEqual({ reason: "Saisie en double" })
  })

  it("shows a final refusal without offering to try again", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) =>
      init?.method === "POST"
        ? jsonResponse(
            { code: "EXPENSE_NOT_CANCELLABLE", message: "La session de caisse de cette dépense est clôturée." },
            409,
          )
        : jsonResponse(expense()),
    )
    const userEvents = userEvent.setup()
    renderPage()

    await userEvents.click(await screen.findByRole("button", { name: "Annuler la dépense" }))
    const dialog = screen.getByRole("dialog", { name: "Annuler cette dépense ?" })
    await userEvents.type(within(dialog).getByLabelText("Motif"), "Erreur")
    await userEvents.click(within(dialog).getByRole("button", { name: "Annuler la dépense" }))

    expect(await within(dialog).findByText("La session de caisse de cette dépense est clôturée.")).toBeInTheDocument()
    expect(within(dialog).queryByRole("button", { name: "Annuler la dépense" })).not.toBeInTheDocument()
    expect(within(dialog).getByRole("button", { name: "Garder la dépense" })).toBeInTheDocument()
  })

  it("is not available offline", () => {
    network.online = false
    const fetchMock = vi.spyOn(globalThis, "fetch")

    renderPage()

    expect(screen.getByText(/redeviendront consultables/)).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
