// @vitest-environment jsdom

import "fake-indexeddb/auto"
import "@testing-library/jest-dom/vitest"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ToastProvider } from "../components/ui/Toast"
import { db } from "../db/database"
import {
  findLocalProductByBarcode,
  getProductCatalogMetadata,
  hasLocalProductCatalog,
} from "../db/products"
import {
  type CreateLocalSaleInput,
  InsufficientLocalStockError,
  createLocalSale,
} from "../db/sales"
import type { LocalCashSession, LocalProduct, LocalSale } from "../db/types"
import { currentUserQueryKey } from "../features/auth/queries"
import { SELECTED_CASH_REGISTER_KEY } from "../features/cash-session/queries"
import type {
  CashRegister,
  CashSession,
  CurrentUser,
  Product,
  Store,
} from "../types/api"
import { PosPage } from "./PosPage"

vi.mock("../db/products", () => ({
  findLocalProductByBarcode: vi.fn(),
  getProductCatalogMetadata: vi.fn(),
  hasLocalProductCatalog: vi.fn(),
  saveProductCatalog: vi.fn(),
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
  is_active: true,
  stock: 20,
  created_at: "2026-08-17T00:00:00Z",
  updated_at: "2026-08-17T00:00:00Z",
}

/**
 * Fake fidèle de createLocalSale : construit la LocalSale résultante à
 * partir de l'input, comme le ferait la vraie transaction Dexie, sans
 * dépendre du contenu réel de la table products.
 */
function buildLocalSaleResult(input: CreateLocalSaleInput): LocalSale {
  const items = input.items.map((item) => {
    const quantity = item.quantity ?? (item.quantityMilli ?? 0) / 1000
    const unitPrice = item.unitPrice ?? 500
    return {
      productId: item.productId,
      productName: coca.name,
      unitPrice,
      quantity,
      lineTotal: Math.round(unitPrice * quantity),
    }
  })
  const total = items.reduce((sum, item) => sum + item.lineTotal, 0)
  const payments = input.payments.map((payment) => {
    const receivedAmount = payment.method === "CASH" ? payment.receivedAmount ?? 0 : null
    return {
      method: payment.method,
      amount: payment.amount,
      receivedAmount,
      changeAmount: receivedAmount === null ? null : receivedAmount - payment.amount,
    }
  })
  return {
    id: "0f9e8d7c-1234-4a5b-9c6d-abcdef012345",
    serverId: null,
    syncEventId: "b1e0aa10-0000-4000-8000-000000000001",
    cashSessionId: input.session.id,
    storeId: input.session.storeId,
    storeName: input.session.storeName ?? "",
    cashRegisterId: input.session.cashRegisterId,
    cashRegisterName: input.session.cashRegisterName,
    cashierId: input.session.cashierId,
    cashierName: input.session.cashierName,
    createdAt: "2026-08-17T20:00:00Z",
    status: "PENDING_SYNC",
    conflictCode: null,
    conflictMessage: null,
    items,
    payments,
    creditAmount: input.credit?.amount ?? 0,
    customer: input.credit?.customer ?? null,
    subtotal: total,
    discount: 0,
    total,
  }
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
      <ToastProvider>
        <MemoryRouter>
          <PosPage />
        </MemoryRouter>
      </ToastProvider>
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
  await userEvents.click(screen.getByRole("button", { name: /Espèces/ }))
}

beforeEach(() => {
  vi.mocked(getProductCatalogMetadata).mockResolvedValue({
    storeId: store.id,
    cachedAt: "2026-08-17T00:00:00Z",
    productCount: 1,
  })
  vi.mocked(createLocalSale).mockImplementation(async (input) =>
    buildLocalSaleResult(input),
  )
})

afterEach(async () => {
  cleanup()
  vi.clearAllMocks()
  vi.restoreAllMocks()
  localStorage.clear()
  document.cookie = "csrftoken=; Max-Age=0; path=/"
  await db.localSales.clear()
  await db.cashSessions.clear()
  await db.carts.clear()
  await db.products.clear()
})

describe("POS sale workflow", () => {
  it("completes a cash sale locally, clears the cart and restores scanner focus", async () => {
    const userEvents = userEvent.setup()
    document.cookie = "csrftoken=test-token; path=/"
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes("/products/")) return jsonResponse([coca])
      throw new Error(`Unexpected request: ${url}`)
    })

    renderPos()
    const scanner = await scanCoca(userEvents)
    await userEvents.type(scanner, `${coca.barcode}{Enter}`)
    await waitFor(() => expect(screen.getByLabelText(`Quantité de ${coca.name}`)).toHaveTextContent("2"))
    await openCashPayment(userEvents)
    await userEvents.type(screen.getByLabelText("Montant reçu"), "2000")
    await userEvents.click(screen.getByRole("button", { name: "Valider et rendre 1 000 FCFA" }))

    expect(await screen.findByRole("heading", { name: "Vente validée" })).toBeInTheDocument()
    const changeRow = screen.getByText("Monnaie à rendre").parentElement!
    expect(within(changeRow).getByText("1 000 FCFA")).toBeInTheDocument()
    expect(screen.getByText("Panier vide")).toBeInTheDocument()
    // Local-first : aucune requête POST /sales/ pendant l'encaissement, la
    // vente part dans l'outbox locale et sera poussée par le sync engine.
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/sales/"))).toBe(false)
    expect(createLocalSale).toHaveBeenCalledWith({
      session: expect.objectContaining({ id: cashSession.id, cashierId: user.id }),
      items: [{ productId: coca.id, quantity: 2 }],
      payments: [{ method: "CASH", amount: 1_000, receivedAmount: 2_000 }],
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
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.mocked(createLocalSale).mockRejectedValue(
      new InsufficientLocalStockError("Coca 50cl", 0, 1),
    )

    renderPos()
    await scanCoca(userEvents)
    await openCashPayment(userEvents)
    await userEvents.type(screen.getByLabelText("Montant reçu"), "1000")
    await userEvents.click(screen.getByRole("button", { name: "Valider et rendre 500 FCFA" }))

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Stock local insuffisant pour Coca 50cl",
    )
    expect(screen.getByLabelText(`Quantité de ${coca.name}`)).toHaveTextContent("1")
    expect(screen.queryByRole("heading", { name: "Vente validée" })).not.toBeInTheDocument()
  })

  it("splits a payment across cash and Wave, accumulating both into one sale", async () => {
    const userEvents = userEvent.setup()
    document.cookie = "csrftoken=test-token; path=/"
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes("/products/")) return jsonResponse([coca])
      throw new Error(`Unexpected request: ${url}`)
    })

    renderPos()
    await scanCoca(userEvents)
    await openCashPayment(userEvents)
    await userEvents.type(screen.getByLabelText("Montant reçu"), "300")
    await userEvents.click(screen.getByRole("button", { name: "Continuer avec un autre moyen" }))

    // De retour au choix du moyen de paiement, pour le reste dû seulement.
    // Le pied de panier garde lui aussi un bouton Wave : on cible la modale.
    expect(await screen.findByText("Reste à payer")).toBeInTheDocument()
    const methodDialog = screen.getByRole("dialog", { name: "Mode de paiement" })
    await userEvents.click(within(methodDialog).getByRole("button", { name: /Wave/ }))
    // Pré-rempli avec le reste — 200, pas le total de 500.
    expect(await screen.findByLabelText("Montant reçu")).toHaveValue("200")
    await userEvents.click(screen.getByRole("button", { name: "Paiement reçu" }))

    expect(await screen.findByRole("heading", { name: "Vente validée" })).toBeInTheDocument()
    expect(createLocalSale).toHaveBeenCalledWith({
      session: expect.objectContaining({ id: cashSession.id, cashierId: user.id }),
      items: [{ productId: coca.id, quantity: 1 }],
      payments: [
        { method: "CASH", amount: 300, receivedAmount: 300 },
        { method: "WAVE", amount: 200, receivedAmount: null },
      ],
    })
    expect(screen.getByText("Paiement 1")).toBeInTheDocument()
    expect(screen.getByText("Paiement 2")).toBeInTheDocument()
  })
})

describe("POS held carts", () => {
  it("suspends the current sale and resumes it later with the same item", async () => {
    const userEvents = userEvent.setup()
    document.cookie = "csrftoken=test-token; path=/"
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes("/products/")) return jsonResponse([coca])
      throw new Error(`Unexpected request: ${url}`)
    })

    // La revalidation à la reprise lit le catalogue local réel (Dexie), pas
    // le mock de `db/products` utilisé par le reste de ce fichier.
    await db.products.put(localCoca)

    renderPos()
    await scanCoca(userEvents)

    await userEvents.click(screen.getByRole("button", { name: /Suspendre/ }))
    await waitFor(() => expect(screen.getByText("Panier vide")).toBeInTheDocument())

    // Le panier suspendu apparaît directement dans le rail : le reprendre
    // coûte un clic, sans modale ni changement de page.
    expect(
      await screen.findByRole("heading", { name: /Paniers en attente/ }),
    ).toBeInTheDocument()
    await userEvents.click(screen.getByRole("button", { name: /Reprendre le panier/ }))

    await waitFor(() =>
      expect(screen.getByLabelText(`Quantité de ${coca.name}`)).toHaveTextContent("1"),
    )
    expect(screen.queryByRole("heading", { name: /Paniers en attente/ })).not.toBeInTheDocument()
  })

  it("arbitre avant d'écraser une vente en cours quand on reprend depuis le rail", async () => {
    const userEvents = userEvent.setup()
    document.cookie = "csrftoken=test-token; path=/"
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes("/products/")) return jsonResponse([coca])
      throw new Error(`Unexpected request: ${url}`)
    })
    await db.products.put(localCoca)

    renderPos()
    await scanCoca(userEvents)
    await userEvents.click(screen.getByRole("button", { name: /Suspendre/ }))
    await waitFor(() => expect(screen.getByText("Panier vide")).toBeInTheDocument())

    // Une nouvelle vente est commencée : reprendre ne doit jamais l'écraser
    // en silence.
    await scanCoca(userEvents)
    await userEvents.click(screen.getByRole("button", { name: /Reprendre le panier/ }))

    expect(
      await screen.findByRole("heading", { name: "Panier actuel non vide" }),
    ).toBeInTheDocument()
    await userEvents.click(
      screen.getByRole("button", { name: "Mettre en attente et reprendre" }),
    )

    await waitFor(() =>
      expect(screen.getByLabelText(`Quantité de ${coca.name}`)).toHaveTextContent("1"),
    )
    // La vente écartée est elle-même retrouvable dans le rail.
    expect(screen.getByRole("button", { name: /Suspendre/ })).toBeInTheDocument()
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
      payments: [{ method: "CASH", amount: 1_000, receivedAmount: 2_000, changeAmount: 1_000 }],
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
    await userEvents.click(screen.getByRole("button", { name: "Valider et rendre 1 000 FCFA" }))

    expect(await screen.findByRole("heading", { name: "Vente validée" })).toBeInTheDocument()
    expect(screen.getByText(/Référence locale/)).toHaveTextContent("0F9E8D7C")
    expect(screen.getByText("Panier vide")).toBeInTheDocument()
    expect(createLocalSale).toHaveBeenCalledWith({
      session: expect.objectContaining({ id: localSession.id, cashierId: user.id }),
      items: [{ productId: coca.id, quantity: 2 }],
      payments: [{ method: "CASH", amount: 1_000, receivedAmount: 2_000 }],
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
      payments: [{ method: "WAVE", amount: 500, receivedAmount: null, changeAmount: null }],
      subtotal: 500,
      discount: 0,
      total: 500,
    }
    vi.mocked(createLocalSale).mockResolvedValue(localSale)

    const userEvents = userEvent.setup()
    renderPos(localSession)
    await scanCoca(userEvents)
    await userEvents.click(screen.getByRole("button", { name: /Wave/ }))
    await userEvents.click(screen.getByRole("button", { name: "Paiement reçu" }))

    expect(await screen.findByRole("heading", { name: "Vente validée" })).toBeInTheDocument()
    expect(screen.getByText(/Référence locale/)).toHaveTextContent("1A2B3C4D")
    expect(createLocalSale).toHaveBeenCalledWith({
      session: expect.objectContaining({ id: localSession.id, cashierId: user.id }),
      items: [{ productId: coca.id, quantity: 1 }],
      payments: [{ method: "WAVE", amount: 500, receivedAmount: null }],
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
    await userEvents.click(screen.getByRole("button", { name: "Valider et rendre 500 FCFA" }))

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Impossible d’enregistrer la vente sur cet appareil. Réessayez avant de poursuivre.",
    )
    expect(screen.getByLabelText(`Quantité de ${coca.name}`)).toHaveTextContent("1")
    expect(screen.queryByRole("heading", { name: "Vente validée" })).not.toBeInTheDocument()
  })

  it("shows one blocking message when no offline catalogue exists", async () => {
    vi.mocked(getProductCatalogMetadata).mockResolvedValue(null)
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"))

    renderPos(localSession)

    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent("Catalogue indisponible hors ligne")
    expect(alert).toHaveTextContent(
      "Connectez cet appareil à Internet une première fois pour préparer le catalogue.",
    )
    expect(
      screen.queryByLabelText("Scanner un code-barres ou rechercher par nom"),
    ).not.toBeInTheDocument()
    expect(screen.getAllByRole("alert")).toHaveLength(1)
  })
})

describe("POS keyboard shortcuts", () => {
  it("completes a cash sale with scanner + keyboard only: F1, digits, Enter", async () => {
    const userEvents = userEvent.setup()
    document.cookie = "csrftoken=test-token; path=/"
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes("/products/")) return jsonResponse([coca])
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
    const changeRow = screen.getByText("Monnaie à rendre").parentElement!
    expect(within(changeRow).getByText("1 000 FCFA")).toBeInTheDocument()
    expect(createLocalSale).toHaveBeenCalledTimes(1)

    await userEvents.keyboard("{Enter}")
    await waitFor(() => expect(scanner).toHaveFocus())
    expect(screen.getByText("Panier vide")).toBeInTheDocument()
  })

  it("completes a Wave sale with scanner + keyboard only: F2, Enter", async () => {
    const userEvents = userEvent.setup()
    document.cookie = "csrftoken=test-token; path=/"
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes("/products/")) return jsonResponse([coca])
      throw new Error(`Unexpected request: ${url}`)
    })

    renderPos()
    const scanner = await scanCoca(userEvents)

    await userEvents.keyboard("{F2}")
    expect(await screen.findByRole("heading", { name: "Paiement Wave" })).toBeInTheDocument()

    await userEvents.keyboard("{Enter}")
    expect(await screen.findByRole("heading", { name: "Vente validée" })).toBeInTheDocument()
    expect(createLocalSale).toHaveBeenCalledTimes(1)

    await userEvents.keyboard("{Enter}")
    await waitFor(() => expect(scanner).toHaveFocus())
  })

  it("never opens checkout or submits a sale from a barcode scan alone", async () => {
    document.cookie = "csrftoken=test-token; path=/"
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes("/products/")) return jsonResponse([coca])
      throw new Error(`Unexpected request during a scan-only flow: ${url}`)
    })
    const userEvents = userEvent.setup()

    renderPos()
    await scanCoca(userEvents)

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(createLocalSale).not.toHaveBeenCalled()
  })

  it("does not open checkout on F1 with an empty cart", async () => {
    document.cookie = "csrftoken=test-token; path=/"
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes("/products/")) return jsonResponse([coca])
      throw new Error(`Unexpected request: ${url}`)
    })
    renderPos()
    await waitFor(() => expect(screen.getByRole("button", { name: /Espèces/ })).toBeDisabled())

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
    await userEvents.click(screen.getByRole("button", { name: `Modifier le prix de ${coca.name}` }))
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

    await userEvents.click(screen.getByRole("button", { name: `Modifier le prix de ${coca.name}` }))
    const priceInput = screen.getByLabelText("Prix pour cette vente")
    await userEvents.clear(priceInput)
    await userEvents.type(priceInput, "450{Enter}")
    await waitFor(() => expect(scanner).toHaveFocus())

    await userEvents.click(screen.getByRole("button", { name: `Supprimer ${coca.name} du panier` }))
    await waitFor(() => expect(scanner).toHaveFocus())
  })

  it("undoes a line removal from the toast, and drops the undo once checkout starts", async () => {
    document.cookie = "csrftoken=test-token; path=/"
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes("/products/")) return jsonResponse([coca])
      throw new Error(`Unexpected request: ${url}`)
    })
    const userEvents = userEvent.setup()
    renderPos()
    const scanner = await scanCoca(userEvents)

    await userEvents.click(screen.getByRole("button", { name: `Supprimer ${coca.name} du panier` }))
    expect(await screen.findByText("Panier vide")).toBeInTheDocument()
    await userEvents.click(screen.getByRole("button", { name: "Annuler" }))

    await waitFor(() => expect(screen.getByLabelText(`Quantité de ${coca.name}`)).toHaveTextContent("1"))
    await waitFor(() => expect(scanner).toHaveFocus())

    await userEvents.click(screen.getByRole("button", { name: `Supprimer ${coca.name} du panier` }))
    await userEvents.type(scanner, `${coca.barcode}{Enter}`)
    await waitFor(() => expect(screen.getByLabelText(`Quantité de ${coca.name}`)).toHaveTextContent("1"))
    await openCashPayment(userEvents)
    expect(screen.queryByText(`${coca.name} retiré du panier`)).not.toBeInTheDocument()
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
    await userEvents.click(screen.getByRole("button", { name: /Espèces/ }))
    expect(screen.getByRole("heading", { name: "Paiement en espèces" })).toBeInTheDocument()

    await userEvents.keyboard("{Escape}")
    expect(await screen.findByRole("heading", { name: "Mode de paiement" })).toBeInTheDocument()

    await userEvents.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    await waitFor(() => expect(scanner).toHaveFocus())
  })
})

describe("POS credit sale (cahier client)", () => {
  const moussa = {
    id: "moussa",
    store_id: store.id,
    name: "Moussa Fall",
    phone: "+221771234567",
    is_active: true,
    balance: "12500.00",
    last_activity_at: null,
    updated_at: "2026-09-01T00:00:00Z",
  }

  function mockServer() {
    document.cookie = "csrftoken=test-token; path=/"
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes("/products/")) return jsonResponse([coca])
      if (url.includes("/customers/")) return jsonResponse([moussa])
      throw new Error(`Unexpected request: ${url}`)
    })
  }

  async function pickMoussa(userEvents: ReturnType<typeof userEvent.setup>) {
    await userEvents.type(await screen.findByLabelText("Téléphone ou nom du client"), "moussa")
    await userEvents.click(await screen.findByRole("button", { name: "Choisir Moussa Fall" }))
  }

  afterEach(async () => {
    await db.customers.clear()
    await db.metadata.clear()
  })

  it("keeps the cart free of any book button", async () => {
    const userEvents = userEvent.setup()
    mockServer()

    renderPos()
    await scanCoca(userEvents)

    expect(screen.queryByRole("button", { name: /cahier/i })).not.toBeInTheDocument()
  })

  it("puts a whole sale on the book when the customer pays nothing now", async () => {
    const userEvents = userEvent.setup()
    mockServer()

    renderPos()
    await scanCoca(userEvents)
    await openCashPayment(userEvents)
    await userEvents.click(screen.getByRole("button", { name: "Mettre 500 FCFA au cahier" }))
    expect(await screen.findByText("À mettre au cahier")).toBeInTheDocument()
    await pickMoussa(userEvents)

    const confirmation = await screen.findByRole("dialog", { name: "Mettre au cahier" })
    expect(within(confirmation).getByText("Moussa Fall")).toBeInTheDocument()
    expect(within(confirmation).getByText("Nouveau solde").nextSibling).toHaveTextContent("13 000 FCFA")
    await userEvents.click(within(confirmation).getByRole("button", { name: "Valider la vente" }))

    expect(await screen.findByRole("heading", { name: "Vente validée" })).toBeInTheDocument()
    expect(createLocalSale).toHaveBeenCalledWith({
      session: expect.objectContaining({ id: cashSession.id }),
      items: [{ productId: coca.id, quantity: 1 }],
      payments: [],
      credit: {
        customer: { id: "moussa", name: "Moussa Fall", phone: "+221771234567" },
        amount: 500,
      },
    })
    expect(screen.getByText("Mis au cahier")).toBeInTheDocument()
    expect(screen.getByText("Client").nextSibling).toHaveTextContent("Moussa Fall")
  })

  it("puts only the rest on the book after a partial cash payment", async () => {
    const userEvents = userEvent.setup()
    mockServer()

    renderPos()
    await scanCoca(userEvents)
    await openCashPayment(userEvents)
    await userEvents.type(screen.getByLabelText("Montant reçu"), "300")
    await userEvents.click(screen.getByRole("button", { name: "Continuer avec un autre moyen" }))
    const methodDialog = await screen.findByRole("dialog", { name: "Mode de paiement" })
    await userEvents.click(within(methodDialog).getByRole("button", { name: /Cahier client/ }))

    expect(await screen.findByText("Reste à mettre au cahier")).toBeInTheDocument()
    await pickMoussa(userEvents)
    const confirmation = await screen.findByRole("dialog", { name: "Mettre au cahier" })
    expect(within(confirmation).getByText("Déjà payé").nextSibling).toHaveTextContent("300 FCFA")
    expect(within(confirmation).getByText("À mettre au cahier").nextSibling).toHaveTextContent("200 FCFA")
    await userEvents.click(within(confirmation).getByRole("button", { name: "Valider la vente" }))

    expect(await screen.findByRole("heading", { name: "Vente validée" })).toBeInTheDocument()
    expect(createLocalSale).toHaveBeenCalledWith(
      expect.objectContaining({
        payments: [{ method: "CASH", amount: 300, receivedAmount: 300 }],
        credit: expect.objectContaining({ amount: 200 }),
      }),
    )
  })

  it("puts the rest on the book right from the cash screen", async () => {
    const userEvents = userEvent.setup()
    mockServer()

    renderPos()
    await scanCoca(userEvents)
    await openCashPayment(userEvents)
    await userEvents.type(screen.getByLabelText("Montant reçu"), "300")
    await userEvents.click(screen.getByRole("button", { name: "Mettre 200 FCFA au cahier" }))

    expect(await screen.findByText("Reste à mettre au cahier")).toBeInTheDocument()
    await pickMoussa(userEvents)
    const confirmation = await screen.findByRole("dialog", { name: "Mettre au cahier" })
    expect(within(confirmation).getByText("Déjà payé").nextSibling).toHaveTextContent("300 FCFA")
    await userEvents.click(within(confirmation).getByRole("button", { name: "Valider la vente" }))

    await screen.findByRole("heading", { name: "Vente validée" })
    expect(createLocalSale).toHaveBeenCalledWith(
      expect.objectContaining({
        payments: [{ method: "CASH", amount: 300, receivedAmount: 300 }],
        credit: expect.objectContaining({ amount: 200 }),
      }),
    )
  })

  it("never offers the book once the amount received covers the total", async () => {
    const userEvents = userEvent.setup()
    mockServer()

    renderPos()
    await scanCoca(userEvents)
    await openCashPayment(userEvents)
    expect(screen.getByRole("button", { name: "Mettre 500 FCFA au cahier" })).toBeInTheDocument()
    await userEvents.type(screen.getByLabelText("Montant reçu"), "500")

    expect(screen.queryByRole("button", { name: /cahier/i })).not.toBeInTheDocument()
  })

  it("puts the rest on the book from a mobile money screen", async () => {
    const userEvents = userEvent.setup()
    mockServer()

    renderPos()
    await scanCoca(userEvents)
    await userEvents.click(screen.getByRole("button", { name: /Wave/ }))
    const amount = await screen.findByLabelText("Montant reçu")
    expect(screen.queryByRole("button", { name: /cahier/i })).not.toBeInTheDocument()
    await userEvents.clear(amount)
    await userEvents.type(amount, "100")
    await userEvents.click(screen.getByRole("button", { name: /Mettre le reste au cahier/ }))

    await pickMoussa(userEvents)
    await userEvents.click(await screen.findByRole("button", { name: "Valider la vente" }))
    await screen.findByRole("heading", { name: "Vente validée" })
    expect(createLocalSale).toHaveBeenCalledWith(
      expect.objectContaining({
        payments: [{ method: "WAVE", amount: 100, receivedAmount: null }],
        credit: expect.objectContaining({ amount: 400 }),
      }),
    )
  })

  it("opens the customer choice with F4", async () => {
    const userEvents = userEvent.setup()
    mockServer()

    renderPos()
    await scanCoca(userEvents)
    fireEvent.keyDown(window, { key: "F4" })

    expect(await screen.findByRole("dialog", { name: "Choisir le client" })).toBeInTheDocument()
  })

  it("goes back to the customer choice without submitting anything", async () => {
    const userEvents = userEvent.setup()
    mockServer()

    renderPos()
    await scanCoca(userEvents)
    fireEvent.keyDown(window, { key: "F4" })
    await pickMoussa(userEvents)
    const confirmation = await screen.findByRole("dialog", { name: "Mettre au cahier" })
    await userEvents.click(within(confirmation).getAllByRole("button", { name: "Changer de client" })[0]!)

    expect(await screen.findByRole("dialog", { name: "Choisir le client" })).toBeInTheDocument()
    expect(createLocalSale).not.toHaveBeenCalled()
  })
})

describe("POS sale success — synchronisation status", () => {
  it("keeps the pending-sync note while the server cannot be reached", async () => {
    const userEvents = userEvent.setup()
    document.cookie = "csrftoken=test-token; path=/"
    vi.mocked(createLocalSale).mockImplementation(async (input) => {
      const sale = buildLocalSaleResult(input)
      await db.localSales.put(sale)
      return sale
    })
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes("/products/")) return jsonResponse([coca])
      // Réseau coupé : la synchronisation échoue, la vente reste en attente.
      throw new TypeError("Failed to fetch")
    })

    renderPos()
    await scanCoca(userEvents)
    await openCashPayment(userEvents)
    await userEvents.type(screen.getByLabelText("Montant reçu"), "500")
    await userEvents.click(screen.getByRole("button", { name: "Valider le paiement" }))
    await screen.findByRole("heading", { name: "Vente validée" })
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/sync/push/"))).toBe(true),
    )

    expect(screen.getByText(/synchronisation automatique/)).toBeInTheDocument()
    expect((await db.localSales.toArray()).map((sale) => sale.status)).toEqual(["PENDING_SYNC"])
  })

  it("drops the pending-sync note as soon as the sale reaches the server", async () => {
    const userEvents = userEvent.setup()
    document.cookie = "csrftoken=test-token; path=/"
    vi.mocked(createLocalSale).mockImplementation(async (input) => {
      // Comme la vraie transaction : la vente est dans Dexie, en attente.
      const sale = buildLocalSaleResult(input)
      await db.localSales.put(sale)
      return sale
    })
    let releasePush: () => void = () => undefined
    const pushGate = new Promise<void>((resolve) => {
      releasePush = resolve
    })
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes("/products/")) return jsonResponse([coca])
      if (url.includes("/sync/push/")) {
        // Le serveur ne répond qu'une fois l'écran de succès affiché.
        await pushGate
        return jsonResponse({
          results: [
            {
              event_id: "b1e0aa10-0000-4000-8000-000000000001",
              status: "SYNCED",
              entity_id: "0f9e8d7c-1234-4a5b-9c6d-abcdef012345",
            },
          ],
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    renderPos()
    await scanCoca(userEvents)
    await openCashPayment(userEvents)
    await userEvents.type(screen.getByLabelText("Montant reçu"), "500")
    await userEvents.click(screen.getByRole("button", { name: "Valider le paiement" }))

    expect(await screen.findByRole("heading", { name: "Vente validée" })).toBeInTheDocument()
    expect(screen.getByText(/synchronisation automatique/)).toBeInTheDocument()

    releasePush()

    await waitFor(() =>
      expect(screen.queryByText(/synchronisation automatique/)).not.toBeInTheDocument(),
    )
    expect(screen.getByRole("heading", { name: "Vente validée" })).toBeInTheDocument()
  })
})
