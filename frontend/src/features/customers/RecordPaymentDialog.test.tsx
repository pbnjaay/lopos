// @vitest-environment jsdom

import "fake-indexeddb/auto"
import "@testing-library/jest-dom/vitest"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { saveCustomerBook } from "../../db/customers"
import { db } from "../../db/database"
import type { CustomerPayment } from "../../types/api"
import type { CustomerSummary } from "./customerService"
import { RecordPaymentDialog } from "./RecordPaymentDialog"

const moussa: CustomerSummary = {
  id: "moussa",
  name: "Moussa Fall",
  phone: "+221771234567",
  balance: 10_000,
  isActive: true,
  lastActivityAt: null,
}

function recorded(overrides: Partial<CustomerPayment> = {}): CustomerPayment {
  return {
    id: "payment-id",
    reference: "RMB-1A2B3C4D",
    customer: { id: "moussa", name: "Moussa Fall", phone: "+221771234567" },
    store: { id: "store-id", name: "Supérette Test" },
    cash_register: { id: "register-id", name: "Caisse 01" },
    cash_session_id: "session-id",
    method: "CASH",
    amount: "4000.00",
    received_amount: "5000.00",
    change_amount: "1000.00",
    balance_before: "10000.00",
    balance_after: "6000.00",
    created_by: "caissier",
    created_at: "2026-09-28T15:00:00Z",
    ...overrides,
  }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function renderDialog(onRecorded = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <RecordPaymentDialog
        customer={moussa}
        storeId="store-id"
        cashSessionId="session-id"
        onClose={vi.fn()}
        onRecorded={onRecorded}
      />
    </QueryClientProvider>,
  )
  return { onRecorded }
}

/** Élément dont le texte est découpé par <Money> : on le retrouve par sa balise. */
function textElement(tag: string, text: string) {
  return screen.getByText(
    (_, element) => element?.tagName.toLowerCase() === tag && Boolean(element.textContent?.includes(text)),
  )
}

function postedBodies(fetchMock: ReturnType<typeof vi.spyOn>) {
  return fetchMock.mock.calls.map(([, init]) => JSON.parse(String((init as RequestInit).body)))
}

afterEach(async () => {
  cleanup()
  vi.restoreAllMocks()
  await db.customers.clear()
  await db.metadata.clear()
})

describe("RecordPaymentDialog", () => {
  it("prefills the full balance and records a cash payment with change", async () => {
    await saveCustomerBook("store-id", [
      {
        id: "moussa", store_id: "store-id", name: "Moussa Fall", phone: "+221771234567",
        is_active: true, balance: "10000.00", last_activity_at: null, updated_at: "2026-09-01T00:00:00Z",
      },
    ])
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(recorded(), 201))
    const user = userEvent.setup()
    const { onRecorded } = renderDialog()

    const amount = screen.getByLabelText("Montant payé")
    expect(amount).toHaveValue("10 000")
    await user.clear(amount)
    await user.type(amount, "4000")
    await user.type(screen.getByLabelText("Montant reçu"), "5000")
    expect(textElement("small", "Monnaie à rendre")).toHaveTextContent("1 000 FCFA")
    expect(textElement("p", "Nouveau solde")).toHaveTextContent("6 000 FCFA")
    await user.click(screen.getByRole("button", { name: "Enregistrer le paiement" }))

    expect(await screen.findByRole("heading", { name: "Paiement enregistré" })).toBeInTheDocument()
    const [body] = postedBodies(fetchMock)
    expect(body).toMatchObject({
      customer_id: "moussa",
      cash_session_id: "session-id",
      method: "CASH",
      amount: "4000.00",
      received_amount: "5000.00",
    })
    expect(body.idempotency_key).toMatch(/^[0-9a-f-]{36}$/)
    expect(onRecorded).toHaveBeenCalledOnce()
    expect(screen.getByRole("link", { name: "Imprimer le reçu" })).toHaveAttribute(
      "href",
      "/customer-payments/payment-id/receipt?cash_session_id=session-id",
    )
    // Le solde confirmé par le serveur est reporté dans le cache local.
    expect((await db.customers.get(["store-id", "moussa"]))?.serverBalance).toBe(6_000)
  })

  it("sends no received amount for a mobile money payment", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(recorded({ method: "WAVE", received_amount: null, change_amount: null }), 201),
    )
    const user = userEvent.setup()
    renderDialog()

    await user.click(screen.getByRole("radio", { name: "Wave" }))
    expect(screen.queryByLabelText("Montant reçu")).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Enregistrer le paiement" }))

    await screen.findByRole("heading", { name: "Paiement enregistré" })
    expect(postedBodies(fetchMock)[0]).toMatchObject({
      method: "WAVE",
      amount: "10000.00",
      received_amount: null,
    })
  })

  it("never lets the cashier take more than the customer owes", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
    const user = userEvent.setup()
    renderDialog()

    const amount = screen.getByLabelText("Montant payé")
    await user.clear(amount)
    await user.type(amount, "12000")
    await user.click(screen.getByRole("button", { name: "Enregistrer le paiement" }))

    expect(screen.getByText("Le montant dépasse ce que le client doit.")).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("reuses the same idempotency key after a network failure", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(jsonResponse(recorded(), 201))
    const user = userEvent.setup()
    renderDialog()

    await user.click(screen.getByRole("button", { name: "Enregistrer le paiement" }))
    await screen.findByText(/nécessite une connexion|hors ligne/i)
    await user.click(screen.getByRole("button", { name: "Enregistrer le paiement" }))

    await screen.findByRole("heading", { name: "Paiement enregistré" })
    const [first, second] = postedBodies(fetchMock)
    expect(second.idempotency_key).toBe(first.idempotency_key)
  })

  it("shows the server refusal and opens a new attempt", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        jsonResponse(
          { code: "CUSTOMER_OVERPAYMENT", message: "Le montant dépasse le solde dû par le client (8 000 FCFA).", balance: "8000.00" },
          409,
        ),
      )
      .mockResolvedValueOnce(jsonResponse(recorded(), 201))
    const user = userEvent.setup()
    renderDialog()

    await user.click(screen.getByRole("button", { name: "Enregistrer le paiement" }))
    expect(await screen.findByText(/dépasse le solde dû par le client \(8 000 FCFA\)/)).toBeInTheDocument()
    const amount = screen.getByLabelText("Montant payé")
    await user.clear(amount)
    await user.type(amount, "8000")
    await user.click(screen.getByRole("button", { name: "Enregistrer le paiement" }))

    await screen.findByRole("heading", { name: "Paiement enregistré" })
    const [first, second] = postedBodies(fetchMock)
    expect(second.idempotency_key).not.toBe(first.idempotency_key)
  })
})

describe("RecordPaymentDialog focus", () => {
  it("keeps typing in the received amount field while the dialog re-renders", async () => {
    const user = userEvent.setup()
    renderDialog()

    const amount = screen.getByLabelText("Montant payé")
    expect(amount).toHaveFocus()
    await user.clear(amount)
    await user.type(amount, "4000")
    await user.type(screen.getByLabelText("Montant reçu"), "5000")

    expect(screen.getByLabelText("Montant payé")).toHaveValue("4 000")
    expect(screen.getByLabelText("Montant reçu")).toHaveValue("5 000")
  })
})
