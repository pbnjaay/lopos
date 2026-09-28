// @vitest-environment jsdom

import "fake-indexeddb/auto"
import "@testing-library/jest-dom/vitest"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { afterEach, describe, expect, it, vi } from "vitest"

import { saveCustomerBook } from "../db/customers"
import { db } from "../db/database"
import type { CashRegister, CashSession, Customer, CustomerDetail, CurrentUser } from "../types/api"
import { CustomerDetailPage } from "./CustomerDetailPage"
import { CustomersPage } from "./CustomersPage"

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

function customer(overrides: Partial<Customer>): Customer {
  return {
    id: "id", store_id: "store-id", name: "Client", phone: null, is_active: true,
    balance: "0.00", last_activity_at: null, updated_at: "2026-09-01T00:00:00Z",
    ...overrides,
  }
}

const book: Customer[] = [
  customer({ id: "moussa", name: "Moussa Fall", phone: "+221771234567", balance: "18500.00", last_activity_at: "2026-09-27T10:00:00Z" }),
  customer({ id: "awa", name: "Awa Diop", phone: "+221760001122", balance: "2500.00" }),
  customer({ id: "fatou", name: "Fatou Sow", phone: "+221780000000", balance: "0.00" }),
  customer({ id: "ancien", name: "Ancien client", balance: "0.00", is_active: false }),
]

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/customers" element={<CustomersPage />} />
          <Route path="/customers/:customerId" element={<CustomerDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(async () => {
  cleanup()
  vi.restoreAllMocks()
  network.online = true
  await db.customers.clear()
  await db.metadata.clear()
  await db.localSales.clear()
})

describe("CustomersPage", () => {
  async function renderBook() {
    await saveCustomerBook("store-id", book)
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(book))
    renderAt("/customers")
    return screen.findByRole("region", { name: "Clients du cahier" })
  }

  it("opens on who owes the most, with the outstanding total", async () => {
    const list = await renderBook()

    const rows = within(list).getAllByRole("link")
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("Moussa Fall"),
      expect.stringContaining("Awa Diop"),
    ])
    expect(rows[0]).toHaveTextContent("77 123 45 67")
    expect(rows[0]).toHaveTextContent("18 500 FCFA")
    expect(rows[0]).toHaveAttribute("href", "/customers/moussa")
    expect(screen.getByRole("status", { name: "Encours du cahier" })).toHaveTextContent("21 000 FCFA")
  })

  it("lists settled customers but hides deactivated ones who owe nothing", async () => {
    const user = userEvent.setup()
    await renderBook()

    await user.click(screen.getByRole("radio", { name: "Soldés" }))

    const list = screen.getByRole("region", { name: "Clients du cahier" })
    expect(within(list).getByText("Fatou Sow")).toBeInTheDocument()
    expect(within(list).queryByText("Ancien client")).not.toBeInTheDocument()
    expect(within(list).queryByText("Moussa Fall")).not.toBeInTheDocument()
  })

  it("searches by any part of the phone number", async () => {
    const user = userEvent.setup()
    await renderBook()

    await user.click(screen.getByRole("radio", { name: "Tous" }))
    await user.type(screen.getByLabelText("Téléphone ou nom"), "0011")

    const list = screen.getByRole("region", { name: "Clients du cahier" })
    expect(within(list).getAllByRole("link")).toHaveLength(1)
    expect(within(list).getByText("Awa Diop")).toBeInTheDocument()
  })
})

describe("CustomerDetailPage", () => {
  const detail: CustomerDetail = {
    ...book[0]!,
    balance: "18500.00",
    entries: [
      {
        id: "e3", entry_type: "CREDIT_SALE", label: "Achat à crédit", amount: "5000.00",
        running_balance: "18500.00", occurred_at: "2026-09-27T10:00:00Z", sale_id: "0f9e8d7c-aaaa-4bbb-8ccc-000000000001",
        sale_return_id: null, customer_payment: null, reference: "", reason: "", created_by: "caissier",
      },
      {
        id: "e2", entry_type: "PAYMENT", label: "Paiement", amount: "-2000.00",
        running_balance: "13500.00", occurred_at: "2026-09-25T10:00:00Z", sale_id: null, sale_return_id: null,
        customer_payment: { id: "pay-1", reference: "RMB-1A2B3C4D", method: "WAVE" },
        reference: "", reason: "", created_by: "caissier",
      },
      {
        id: "e1", entry_type: "OPENING_BALANCE", label: "Solde d’ouverture", amount: "15500.00",
        running_balance: "15500.00", occurred_at: "2026-09-01T10:00:00Z", sale_id: null, sale_return_id: null,
        customer_payment: null, reference: "ACCESS:1", reason: "", created_by: null,
      },
    ],
  }

  it("shows the balance and each line of the book with the balance after it", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(detail))
    renderAt("/customers/moussa")

    expect(await screen.findByRole("heading", { name: "Moussa Fall" })).toBeInTheDocument()
    expect(screen.getByRole("region", { name: "Solde du client" })).toHaveTextContent("18 500 FCFA")
    const history = screen.getByRole("region", { name: "Historique du cahier" })
    const rows = within(history).getAllByRole("listitem")
    expect(rows[0]).toHaveTextContent("Achat")
    expect(rows[0]).toHaveTextContent("+ 5 000 FCFA")
    expect(rows[0]).toHaveTextContent("Solde 18 500 FCFA")
    expect(rows[1]).toHaveTextContent("Paiement Wave")
    expect(rows[1]).toHaveTextContent("− 2 000 FCFA")
    expect(within(rows[1]!).getByRole("link", { name: "Reçu RMB-1A2B3C4D" })).toHaveAttribute(
      "href",
      "/customer-payments/pay-1/receipt",
    )
    expect(rows[2]).toHaveTextContent("Solde d’ouverture")
    expect(screen.getByRole("button", { name: "Enregistrer un paiement" })).toBeEnabled()
  })

  it("adds this device's unsynced credit sales but only offers what the server can collect", async () => {
    await db.localSales.add({
      id: "pending-sale", serverId: null, syncEventId: "event", cashSessionId: session.id,
      storeId: "store-id", storeName: "Supérette Test", cashRegisterId: register.id,
      cashRegisterName: "Caisse 01", cashierId: user.id, cashierName: "Awa",
      createdAt: "2026-09-28T09:00:00Z", status: "PENDING_SYNC", conflictCode: null, conflictMessage: null,
      items: [], payments: [], creditAmount: 1_000,
      customer: { id: "moussa", name: "Moussa Fall", phone: "+221771234567" },
      subtotal: 1_000, discount: 0, total: 1_000,
    })
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(detail))
    const userEvents = userEvent.setup()
    renderAt("/customers/moussa")

    // Le solde serveur s'affiche d'abord ; la dette en attente s'y ajoute
    // dès que la lecture locale répond.
    await screen.findByText(/de ventes en attente de synchronisation/)
    const balance = screen.getByRole("region", { name: "Solde du client" })
    expect(balance).toHaveTextContent("19 500 FCFA")
    expect(balance).toHaveTextContent("dont 1 000 FCFA de ventes en attente de synchronisation")
    await userEvents.click(screen.getByRole("button", { name: "Enregistrer un paiement" }))
    expect(screen.getByLabelText("Montant payé")).toHaveValue("18 500")
  })

  it("does not offer a payment to a settled customer", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ ...detail, balance: "0.00", entries: [] }),
    )
    renderAt("/customers/moussa")

    expect(await screen.findByRole("button", { name: "Enregistrer un paiement" })).toBeDisabled()
  })

  it("falls back to the cached balance offline, without payments", async () => {
    network.online = false
    await saveCustomerBook("store-id", book)
    const fetchMock = vi.spyOn(globalThis, "fetch")
    renderAt("/customers/moussa")

    expect(await screen.findByRole("region", { name: "Solde du client" })).toHaveTextContent("18 500 FCFA")
    expect(screen.getByText(/L’historique et les paiements reviennent avec la connexion/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Enregistrer un paiement" })).toBeDisabled()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
