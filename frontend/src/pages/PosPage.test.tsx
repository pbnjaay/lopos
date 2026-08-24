// @vitest-environment jsdom

import "fake-indexeddb/auto"
import "@testing-library/jest-dom/vitest"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { afterEach, describe, expect, it, vi } from "vitest"

import { db } from "../db/database"
import { findLocalProductByBarcode, hasLocalProductCatalog } from "../db/products"
import { createLocalSale } from "../db/sales"
import type { LocalCashSession, LocalProduct, LocalSale } from "../db/types"
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

vi.mock("../db/products", () => ({
  findLocalProductByBarcode: vi.fn(),
  hasLocalProductCatalog: vi.fn(),
  searchLocalProducts: vi.fn(),
}))
vi.mock("../db/sales", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db/sales")>()
  return { ...actual, createLocalSale: vi.fn() }
})

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

const completedWaveSale: SaleResponse = {
  id: "wave-sale-id",
  status: "COMPLETED",
  subtotal: "500.00",
  discount: "0.00",
  total: "500.00",
  payment: {
    method: "WAVE",
    amount: "500.00",
    received_amount: null,
    change_amount: null,
  },
  items: [
    {
      product_id: coca.id,
      product_name: coca.name,
      unit_price: "500.00",
      quantity: 1,
      line_total: "500.00",
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

function renderPos(localSession?: LocalCashSession) {
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
  if (localSession) {
    queryClient.setQueryData(["local-cash-session", cashRegister.id], localSession)
  }

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
  await waitFor(() => expect(screen.getByLabelText(`Quantité de ${coca.name}`)).toHaveTextContent("1"))
  return scanner
}

async function openCashPayment(userEvents: ReturnType<typeof userEvent.setup>) {
  await userEvents.click(screen.getByRole("button", { name: "Encaisser" }))
  await userEvents.click(screen.getByRole("button", { name: /Espèces/ }))
}

afterEach(async () => {
  cleanup()
  vi.clearAllMocks()
  vi.restoreAllMocks()
  localStorage.clear()
  document.cookie = "csrftoken=; Max-Age=0; path=/"
  await db.localSales.clear()
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
    await waitFor(() => expect(screen.getByLabelText(`Quantité de ${coca.name}`)).toHaveTextContent("2"))
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
    expect(screen.getByLabelText(`Quantité de ${coca.name}`)).toHaveTextContent("1")
    expect(screen.queryByRole("heading", { name: "Vente validée" })).not.toBeInTheDocument()
  })
})

const localCoca: LocalProduct = {
  id: coca.id,
  storeId: store.id,
  name: coca.name,
  barcode: coca.barcode,
  sellingPrice: 500,
  serverKnownStock: 20,
  pendingSoldQuantity: 0,
  isActive: true,
  cachedAt: "2026-08-17T00:00:00Z",
}

const localSession: LocalCashSession = {
  id: cashSession.id,
  cashRegisterId: cashRegister.id,
  cashRegisterName: cashRegister.name,
  storeId: store.id,
  storeName: store.name,
  cashierId: user.id,
  cashierName: user.first_name,
  openingBalance: 15_000,
  openedAt: cashSession.opened_at,
  status: "OPEN",
  cachedAt: "2026-08-17T00:00:00Z",
}

function setOnline(value: boolean) {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(value)
}

describe("POS sale workflow offline", () => {
  it("completes a cash sale locally, marks it PENDING_SYNC and clears the cart", async () => {
    setOnline(false)
    vi.mocked(hasLocalProductCatalog).mockResolvedValue(true)
    vi.mocked(findLocalProductByBarcode).mockResolvedValue(localCoca)
    const localSale: LocalSale = {
      id: "0f9e8d7c-1234-4a5b-9c6d-abcdef012345",
      serverId: null,
      syncEventId: "sync-event-" + Math.random().toString(36).slice(2),
      cashSessionId: localSession.id,
      storeId: store.id,
      storeName: store.name,
      cashRegisterId: cashRegister.id,
      cashRegisterName: cashRegister.name,
      cashierId: user.id,
      cashierName: user.first_name,
      createdAt: "2026-08-17T20:00:00Z",
      status: "PENDING_SYNC",
      conflictCode: null,
      conflictMessage: null,
      items: [
        {
          productId: coca.id,
          productName: coca.name,
          unitPrice: 500,
          quantity: 2,
          lineTotal: 1_000,
        },
      ],
      payment: { method: "CASH", amount: 1_000, receivedAmount: 2_000, changeAmount: 1_000 },
      subtotal: 1_000,
      discount: 0,
      total: 1_000,
    }
    vi.mocked(createLocalSale).mockResolvedValue(localSale)

    const userEvents = userEvent.setup()
    renderPos(localSession)
    const scanner = await scanCoca(userEvents)
    await userEvents.type(scanner, `${coca.barcode}{Enter}`)
    await waitFor(() => expect(screen.getByLabelText(`Quantité de ${coca.name}`)).toHaveTextContent("2"))
    await openCashPayment(userEvents)
    await userEvents.type(screen.getByLabelText("Montant reçu"), "2000")
    await userEvents.click(screen.getByRole("button", { name: "Valider" }))

    expect(await screen.findByRole("heading", { name: "Vente validée" })).toBeInTheDocument()
    expect(screen.getByText(/Vente enregistrée hors ligne/)).toHaveTextContent("0F9E8D7C")
    expect(screen.getByText("Panier vide")).toBeInTheDocument()
    expect(createLocalSale).toHaveBeenCalledWith({
      session: localSession,
      items: [{ productId: coca.id, quantity: 2 }],
      payment: { method: "CASH", receivedAmount: 2_000 },
    })
  })

  it("completes a WAVE sale locally with a manually confirmed payment", async () => {
    setOnline(false)
    vi.mocked(hasLocalProductCatalog).mockResolvedValue(true)
    vi.mocked(findLocalProductByBarcode).mockResolvedValue(localCoca)
    const localSale: LocalSale = {
      id: "1a2b3c4d-5678-4a5b-9c6d-abcdef012345",
      serverId: null,
      syncEventId: "sync-event-" + Math.random().toString(36).slice(2),
      cashSessionId: localSession.id,
      storeId: store.id,
      storeName: store.name,
      cashRegisterId: cashRegister.id,
      cashRegisterName: cashRegister.name,
      cashierId: user.id,
      cashierName: user.first_name,
      createdAt: "2026-08-17T20:05:00Z",
      status: "PENDING_SYNC",
      conflictCode: null,
      conflictMessage: null,
      items: [
        {
          productId: coca.id,
          productName: coca.name,
          unitPrice: 500,
          quantity: 1,
          lineTotal: 500,
        },
      ],
      payment: { method: "WAVE", amount: 500, receivedAmount: null, changeAmount: null },
      subtotal: 500,
      discount: 0,
      total: 500,
    }
    vi.mocked(createLocalSale).mockResolvedValue(localSale)

    const userEvents = userEvent.setup()
    renderPos(localSession)
    await scanCoca(userEvents)
    await userEvents.click(screen.getByRole("button", { name: "Encaisser" }))
    await userEvents.click(screen.getByRole("button", { name: /Wave/ }))
    await userEvents.click(screen.getByRole("button", { name: "Paiement reçu" }))

    expect(await screen.findByRole("heading", { name: "Vente validée" })).toBeInTheDocument()
    expect(screen.getByText(/Vente enregistrée hors ligne/)).toHaveTextContent("1A2B3C4D")
    expect(createLocalSale).toHaveBeenCalledWith({
      session: localSession,
      items: [{ productId: coca.id, quantity: 1 }],
      payment: { method: "WAVE", receivedAmount: null },
    })
  })

  it("keeps the cart and shows an error when local persistence fails", async () => {
    setOnline(false)
    vi.mocked(hasLocalProductCatalog).mockResolvedValue(true)
    vi.mocked(findLocalProductByBarcode).mockResolvedValue(localCoca)
    vi.mocked(createLocalSale).mockRejectedValue(
      new Error("Impossible d'enregistrer la vente localement."),
    )

    const userEvents = userEvent.setup()
    renderPos(localSession)
    await scanCoca(userEvents)
    await openCashPayment(userEvents)
    await userEvents.type(screen.getByLabelText("Montant reçu"), "1000")
    await userEvents.click(screen.getByRole("button", { name: "Valider" }))

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Impossible d'enregistrer la vente localement.",
    )
    expect(screen.getByLabelText(`Quantité de ${coca.name}`)).toHaveTextContent("1")
    expect(screen.queryByRole("heading", { name: "Vente validée" })).not.toBeInTheDocument()
  })
})

describe("POS keyboard shortcuts", () => {
  it("completes a cash sale with scanner + keyboard only: F1, digits, Enter", async () => {
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
    await waitFor(() => expect(screen.getByLabelText(`Quantité de ${coca.name}`)).toHaveTextContent("2"))

    await userEvents.keyboard("{F1}")
    await waitFor(() => expect(screen.getByLabelText("Montant reçu")).toHaveFocus())
    await userEvents.keyboard("2000{Enter}")

    expect(await screen.findByRole("heading", { name: "Vente validée" })).toBeInTheDocument()
    const changeRow = screen.getByText("Monnaie").parentElement!
    expect(within(changeRow).getByText("1 000 FCFA")).toBeInTheDocument()
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/sales/")),
    ).toHaveLength(1)

    await userEvents.keyboard("{Enter}")
    await waitFor(() => expect(scanner).toHaveFocus())
    expect(screen.getByText("Panier vide")).toBeInTheDocument()
  })

  it("completes a Wave sale with scanner + keyboard only: F2, Enter", async () => {
    const userEvents = userEvent.setup()
    document.cookie = "csrftoken=test-token; path=/"
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes("/products/")) return jsonResponse([coca])
      if (url.endsWith("/sales/")) return jsonResponse(completedWaveSale, 201)
      throw new Error(`Unexpected request: ${url}`)
    })

    renderPos()
    const scanner = await scanCoca(userEvents)

    await userEvents.keyboard("{F2}")
    expect(await screen.findByRole("heading", { name: "Paiement Wave" })).toBeInTheDocument()

    await userEvents.keyboard("{Enter}")
    expect(await screen.findByRole("heading", { name: "Vente validée" })).toBeInTheDocument()
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/sales/")),
    ).toHaveLength(1)

    await userEvents.keyboard("{Enter}")
    await waitFor(() => expect(scanner).toHaveFocus())
  })

  it("never opens checkout or submits a sale from a barcode scan alone", async () => {
    document.cookie = "csrftoken=test-token; path=/"
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes("/products/")) return jsonResponse([coca])
      throw new Error(`Unexpected request during a scan-only flow: ${url}`)
    })
    const userEvents = userEvent.setup()

    renderPos()
    await scanCoca(userEvents)

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/sales/"))).toBe(false)
  })

  it("does not open checkout on F1 with an empty cart", async () => {
    document.cookie = "csrftoken=test-token; path=/"
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes("/products/")) return jsonResponse([coca])
      throw new Error(`Unexpected request: ${url}`)
    })
    renderPos()
    await waitFor(() => expect(screen.getByRole("button", { name: "Encaisser" })).toBeDisabled())

    fireEvent.keyDown(window, { key: "F1" })

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("ignores a held-down F1 key repeat", async () => {
    document.cookie = "csrftoken=test-token; path=/"
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes("/products/")) return jsonResponse([coca])
      throw new Error(`Unexpected request: ${url}`)
    })
    const userEvents = userEvent.setup()
    renderPos()
    await scanCoca(userEvents)

    fireEvent.keyDown(window, { key: "F1", repeat: true })

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("suspends checkout shortcuts while a cart dialog is open", async () => {
    document.cookie = "csrftoken=test-token; path=/"
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes("/products/")) return jsonResponse([coca])
      throw new Error(`Unexpected request: ${url}`)
    })
    const userEvents = userEvent.setup()
    renderPos()
    await scanCoca(userEvents)
    await userEvents.click(screen.getByRole("button", { name: "Modifier le prix" }))
    expect(screen.getByRole("heading", { name: "Modifier le prix" })).toBeInTheDocument()

    await userEvents.keyboard("{F1}")

    expect(screen.queryByRole("heading", { name: "Paiement en espèces" })).not.toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Modifier le prix" })).toBeInTheDocument()
  })

  it("restores scanner focus after cart interactions", async () => {
    document.cookie = "csrftoken=test-token; path=/"
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes("/products/")) return jsonResponse([coca])
      throw new Error(`Unexpected request: ${url}`)
    })
    const userEvents = userEvent.setup()
    renderPos()
    const scanner = await scanCoca(userEvents)

    await userEvents.click(screen.getByLabelText(`Quantité de ${coca.name}`))
    await userEvents.keyboard("{Escape}")
    await waitFor(() => expect(scanner).toHaveFocus())

    await userEvents.click(screen.getByRole("button", { name: "Modifier le prix" }))
    const priceInput = screen.getByLabelText("Prix pour cette vente")
    await userEvents.clear(priceInput)
    await userEvents.type(priceInput, "450{Enter}")
    await waitFor(() => expect(scanner).toHaveFocus())

    await userEvents.click(screen.getByRole("button", { name: `Supprimer ${coca.name} du panier` }))
    await waitFor(() => expect(scanner).toHaveFocus())
  })

  it("backs out of checkout one Escape at a time, ending with scanner focus", async () => {
    document.cookie = "csrftoken=test-token; path=/"
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes("/products/")) return jsonResponse([coca])
      throw new Error(`Unexpected request during an Escape-only flow: ${url}`)
    })
    const userEvents = userEvent.setup()

    renderPos()
    const scanner = await scanCoca(userEvents)
    await userEvents.click(screen.getByRole("button", { name: "Encaisser" }))
    await userEvents.click(screen.getByRole("button", { name: /Espèces/ }))
    expect(screen.getByRole("heading", { name: "Paiement en espèces" })).toBeInTheDocument()

    await userEvents.keyboard("{Escape}")
    expect(await screen.findByRole("heading", { name: "Mode de paiement" })).toBeInTheDocument()

    await userEvents.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    await waitFor(() => expect(scanner).toHaveFocus())
  })
})
