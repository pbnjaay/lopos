// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { afterEach, describe, expect, it, vi } from "vitest"

import { currentUserQueryKey } from "../features/auth/queries"
import { SELECTED_CASH_REGISTER_KEY } from "../features/cash-session/queries"
import type {
  CashRegister,
  CashSession,
  CurrentUser,
  Product,
  SaleResponse,
  Store,
} from "../types/api"
import { PosPage } from "./PosPage"

const user: CurrentUser = {
  id: 7,
  username: "caissier",
  email: "",
  first_name: "Awa",
  last_name: "Diop",
  is_staff: false,
}

const store: Store = {
  id: "store-id",
  name: "Supérette Test",
  address: null,
  is_active: true,
  created_at: "2026-08-17T00:00:00Z",
  updated_at: "2026-08-17T00:00:00Z",
}

const cashRegister: CashRegister = {
  id: "register-id",
  store_id: store.id,
  name: "Caisse 01",
  is_active: true,
  created_at: "2026-08-17T00:00:00Z",
  updated_at: "2026-08-17T00:00:00Z",
}

const cashSession: CashSession = {
  id: "session-id",
  cash_register_id: cashRegister.id,
  cashier_id: user.id,
  opening_balance: "15000.00",
  status: "OPEN",
  opened_at: "2026-08-17T00:00:00Z",
  closing_balance: null,
  expected_balance: null,
  difference: null,
  closed_at: null,
}

const coca: Product = {
  id: "product-id",
  name: "Coca 50cl",
  barcode: "123456789",
  selling_price: "500.00",
  purchase_price: null,
  is_active: true,
  stock: 20,
  created_at: "2026-08-17T00:00:00Z",
  updated_at: "2026-08-17T00:00:00Z",
}

const completedSale: SaleResponse = {
  id: "sale-id",
  status: "COMPLETED",
  subtotal: "1000.00",
  discount: "0.00",
  total: "1000.00",
  payment: {
    method: "CASH",
    amount: "1000.00",
    received_amount: "2000.00",
    change_amount: "1000.00",
  },
  items: [
    {
      product_id: coca.id,
      product_name: coca.name,
      unit_price: "500.00",
      quantity: 2,
      line_total: "1000.00",
    },
  ],
  created_at: "2026-08-17T00:00:00Z",
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function renderPos() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  })
  queryClient.setQueryData(currentUserQueryKey, user)
  queryClient.setQueryData(["cash-registers"], [cashRegister])
  queryClient.setQueryData(
    ["cash-registers", cashRegister.id, "current-session"],
    cashSession,
  )
  queryClient.setQueryData(["stores", store.id], store)
  localStorage.setItem(SELECTED_CASH_REGISTER_KEY, cashRegister.id)

  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <PosPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

async function scanCoca(userEvents: ReturnType<typeof userEvent.setup>) {
  const scanner = screen.getByLabelText("Scanner un code-barres ou rechercher par nom")
  await userEvents.type(scanner, `${coca.barcode}{Enter}`)
  await waitFor(() => expect(screen.getByLabelText(`Quantité de ${coca.name}`)).toHaveValue(1))
  return scanner
}

async function openCashPayment(userEvents: ReturnType<typeof userEvent.setup>) {
  await userEvents.click(screen.getByRole("button", { name: "Encaisser" }))
  await userEvents.click(screen.getByRole("button", { name: /Espèces/ }))
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  localStorage.clear()
  document.cookie = "csrftoken=; Max-Age=0; path=/"
})

describe("POS sale workflow", () => {
  it("completes a cash sale, clears the cart and restores scanner focus", async () => {
    const userEvents = userEvent.setup()
    document.cookie = "csrftoken=test-token; path=/"
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes("/products/")) return jsonResponse([coca])
      if (url.endsWith("/sales/")) return jsonResponse(completedSale, 201)
      throw new Error(`Unexpected request: ${url}`)
    })

    renderPos()
    const scanner = await scanCoca(userEvents)
    await userEvents.type(scanner, `${coca.barcode}{Enter}`)
    await waitFor(() => expect(screen.getByLabelText(`Quantité de ${coca.name}`)).toHaveValue(2))
    await openCashPayment(userEvents)
    await userEvents.type(screen.getByLabelText("Montant reçu"), "2000")
    await userEvents.click(screen.getByRole("button", { name: "Valider" }))

    expect(await screen.findByRole("heading", { name: "Vente validée" })).toBeInTheDocument()
    const changeRow = screen.getByText("Monnaie").parentElement!
    expect(within(changeRow).getByText("1 000 FCFA")).toBeInTheDocument()
    expect(screen.getByText("Panier vide")).toBeInTheDocument()
    const saleCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/sales/"))
    expect(JSON.parse(String(saleCall?.[1]?.body))).toEqual({
      cash_session_id: cashSession.id,
      items: [{ product_id: coca.id, quantity: 2 }],
      payment: { method: "CASH", received_amount: "2000.00" },
    })

    await userEvents.click(screen.getByRole("button", { name: "Nouvelle vente" }))
    await waitFor(() => expect(scanner).toHaveFocus())
  })

  it("shows an insufficient-stock error and preserves the cart", async () => {
    const userEvents = userEvent.setup()
    document.cookie = "csrftoken=test-token; path=/"
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes("/products/")) return jsonResponse([coca])
      if (url.endsWith("/sales/")) {
        return jsonResponse(
          {
            code: "INSUFFICIENT_STOCK",
            message: "Stock insuffisant pour Coca 50cl.",
          },
          409,
        )
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    renderPos()
    await scanCoca(userEvents)
    await openCashPayment(userEvents)
    await userEvents.type(screen.getByLabelText("Montant reçu"), "1000")
    await userEvents.click(screen.getByRole("button", { name: "Valider" }))

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Stock insuffisant pour Coca 50cl.",
    )
    expect(screen.getByLabelText(`Quantité de ${coca.name}`)).toHaveValue(1)
    expect(screen.queryByRole("heading", { name: "Vente validée" })).not.toBeInTheDocument()
  })
})
