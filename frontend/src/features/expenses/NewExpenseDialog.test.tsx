// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { Expense, ExpenseCategory } from "../../types/api"
import { NewExpenseDialog } from "./NewExpenseDialog"

const network = vi.hoisted(() => ({ online: true }))
vi.mock("../offline/useNetworkStatus", () => ({ useNetworkStatus: () => network.online }))

const categories: ExpenseCategory[] = [
  { id: "electricite", name: "Électricité", requires_description: false },
  { id: "autre", name: "Autre", requires_description: true },
]

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

function recorded(overrides: Partial<Expense> = {}): Expense {
  return {
    id: "expense-id", reference: "DEP-1A2B3C4D", category: categories[0]!, amount: "15000.00",
    payment_method: "CASH", description: "", document_reference: "", status: "POSTED",
    store: { id: "store-id", name: "Supérette Test" }, cash_register: { id: "register-id", name: "Caisse 01" },
    cash_session_id: "session-id", occurred_at: "2026-09-29T10:00:00Z", created_by: "caissier",
    cancelled_at: null, cancelled_by: null, cancellation_reason: "", can_cancel: true,
    ...overrides,
  }
}

/** Catégories servies d'office ; `post` répond à la saisie. */
function mockApi(post: () => Response) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    if (String(input).includes("expense-categories")) return jsonResponse(categories)
    if (init?.method === "POST") return post()
    throw new Error(`Requête inattendue : ${String(input)}`)
  })
}

function postedBodies(fetchMock: ReturnType<typeof vi.spyOn>) {
  return fetchMock.mock.calls
    .filter(([, init]) => (init as RequestInit | undefined)?.method === "POST")
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)))
}

function renderDialog() {
  const onRecorded = vi.fn()
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <NewExpenseDialog cashSessionId="session-id" onClose={vi.fn()} onRecorded={onRecorded} />
    </QueryClientProvider>,
  )
  return { onRecorded }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  network.online = true
})

describe("NewExpenseDialog", () => {
  it("starts on the amount, with no category chosen for the cashier", async () => {
    mockApi(() => jsonResponse(recorded(), 201))
    renderDialog()

    expect(screen.getByLabelText("Montant")).toHaveFocus()
    const electricity = await screen.findByRole("radio", { name: "Électricité" })
    expect(electricity).not.toBeChecked()
    // Aucun choix fait : la première catégorie reste atteignable au clavier.
    expect(electricity).toHaveAttribute("tabindex", "0")
    expect(screen.getByRole("radio", { name: "Espèces" })).toBeChecked()
  })

  it("requires an amount and a category before sending anything", async () => {
    const fetchMock = mockApi(() => jsonResponse(recorded(), 201))
    const userEvents = userEvent.setup()
    renderDialog()
    await screen.findByRole("radio", { name: "Électricité" })

    await userEvents.click(screen.getByRole("button", { name: "Enregistrer" }))
    expect(screen.getByText("Saisissez le montant de la dépense.")).toBeInTheDocument()

    await userEvents.type(screen.getByLabelText("Montant"), "15000")
    await userEvents.click(screen.getByRole("button", { name: "Enregistrer" }))
    expect(screen.getByText("Choisissez une catégorie.")).toBeInTheDocument()

    expect(postedBodies(fetchMock)).toEqual([])
  })

  it("asks what was paid when the category needs it", async () => {
    const fetchMock = mockApi(() => jsonResponse(recorded(), 201))
    const userEvents = userEvent.setup()
    renderDialog()

    await userEvents.type(screen.getByLabelText("Montant"), "3000")
    await userEvents.click(await screen.findByRole("radio", { name: "Autre" }))
    expect(screen.getByLabelText("Description (obligatoire)")).toBeInTheDocument()
    await userEvents.click(screen.getByRole("button", { name: "Enregistrer" }))

    expect(screen.getByText("Précisez ce qui a été payé pour « Autre ».")).toBeInTheDocument()
    expect(screen.getByLabelText("Description (obligatoire)")).toHaveFocus()
    expect(postedBodies(fetchMock)).toEqual([])
  })

  it("sends a Wave expense with its description and reference", async () => {
    const fetchMock = mockApi(() => jsonResponse(recorded({ payment_method: "WAVE" }), 201))
    const userEvents = userEvent.setup()
    const { onRecorded } = renderDialog()

    await userEvents.type(screen.getByLabelText("Montant"), "15000")
    expect(screen.getByLabelText("Montant")).toHaveValue("15 000")
    await userEvents.click(await screen.findByRole("radio", { name: "Électricité" }))
    await userEvents.click(screen.getByRole("radio", { name: "Wave" }))
    expect(screen.getByText(/les espèces attendues ne changent pas/)).toBeInTheDocument()
    await userEvents.type(screen.getByLabelText("Description"), " Facture août ")
    await userEvents.type(screen.getByLabelText("Référence"), "SENELEC-0825")
    await userEvents.click(screen.getByRole("button", { name: "Enregistrer" }))

    await vi.waitFor(() => expect(onRecorded).toHaveBeenCalledTimes(1))
    const [body] = postedBodies(fetchMock)
    expect(body).toMatchObject({
      cash_session_id: "session-id",
      category_id: "electricite",
      payment_method: "WAVE",
      amount: "15000.00",
      description: "Facture août",
      document_reference: "SENELEC-0825",
    })
    expect(body.idempotency_key).toEqual(expect.any(String))
  })

  it("shows the server refusal and retries with a fresh key", async () => {
    let attempt = 0
    const fetchMock = mockApi(() => {
      attempt += 1
      return attempt === 1
        ? jsonResponse(
            {
              code: "INSUFFICIENT_CASH",
              message: "Pas assez d’espèces en caisse : 5 000 FCFA attendus.",
              available: "5000.00",
            },
            409,
          )
        : jsonResponse(recorded({ amount: "5000.00" }), 201)
    })
    const userEvents = userEvent.setup()
    const { onRecorded } = renderDialog()

    await userEvents.type(screen.getByLabelText("Montant"), "15000")
    await userEvents.click(await screen.findByRole("radio", { name: "Électricité" }))
    await userEvents.click(screen.getByRole("button", { name: "Enregistrer" }))

    expect(await screen.findByText("Pas assez d’espèces en caisse : 5 000 FCFA attendus.")).toBeInTheDocument()
    expect(onRecorded).not.toHaveBeenCalled()

    await userEvents.clear(screen.getByLabelText("Montant"))
    await userEvents.type(screen.getByLabelText("Montant"), "5000")
    await userEvents.click(screen.getByRole("button", { name: "Enregistrer" }))

    await vi.waitFor(() => expect(onRecorded).toHaveBeenCalledTimes(1))
    const [first, second] = postedBodies(fetchMock)
    expect(second.idempotency_key).not.toBe(first.idempotency_key)
  })

  it("cannot record anything offline", () => {
    network.online = false
    vi.spyOn(globalThis, "fetch")
    renderDialog()

    expect(screen.getByText(/s’enregistre en ligne/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Enregistrer" })).toBeDisabled()
  })
})
