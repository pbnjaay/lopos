// @vitest-environment jsdom

/**
 * Reproduction fidèle des deux bugs observés en pilote, sans mock des
 * repositories Dexie et avec la configuration React Query de production :
 *
 * Bug 1 — première vente juste après la coupure réseau, sans refresh :
 * l'événement `offline` a basculé l'onlineManager de TanStack Query, et le
 * cache `["local-cash-session", ...]` contient encore le `null` d'avant
 * l'ouverture de session. Avant correction, la mutation d'encaissement
 * était mise en pause (networkMode "online") ou échouait sur la session
 * locale figée.
 *
 * Bug 2 — produit jamais recherché introuvable hors ligne : avant
 * correction, la query de recherche d'un terme inédit était mise en pause
 * et le fallback Dexie contenu dans son queryFn ne s'exécutait jamais.
 */

import "fake-indexeddb/auto"
import "@testing-library/jest-dom/vitest"

import { QueryClientProvider, onlineManager } from "@tanstack/react-query"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { db } from "../db/database"
import { saveProductCatalog } from "../db/products"
import { currentUserQueryKey } from "../features/auth/queries"
import { SELECTED_CASH_REGISTER_KEY } from "../features/cash-session/queries"
import { syncPendingSales } from "../sync/syncEngine"
import { createQueryClient } from "../queryClient"
import type {
  CashRegister,
  CashSession,
  CurrentUser,
  Product,
  Store,
} from "../types/api"
import type { LocalCashSession } from "../db/types"
import { PosPage } from "./PosPage"

vi.mock("../sync/syncEngine", () => ({
  syncPendingSales: vi.fn(),
  isSyncPendingSalesRunning: vi.fn().mockReturnValue(false),
}))

const user: CurrentUser = {
  id: 7,
  username: "caissier",
  email: "",
  first_name: "Awa",
  last_name: "Diop",
  is_staff: false,
}

const store: Store = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Supérette Pilote",
  address: null,
  is_active: true,
  created_at: "2026-08-17T00:00:00Z",
  updated_at: "2026-08-17T00:00:00Z",
}

const cashRegister: CashRegister = {
  id: "22222222-2222-4222-8222-222222222222",
  store_id: store.id,
  name: "Caisse 01",
  is_active: true,
  created_at: "2026-08-17T00:00:00Z",
  updated_at: "2026-08-17T00:00:00Z",
}

const cashSession: CashSession = {
  id: "33333333-3333-4333-8333-333333333333",
  cash_register_id: cashRegister.id,
  cashier_id: user.id,
  opening_balance: "15000.00",
  status: "OPEN",
  opened_at: "2026-08-26T08:00:00Z",
  closing_balance: null,
  expected_balance: null,
  difference: null,
  closed_at: null,
}

const openLocalSession: LocalCashSession = {
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
  cachedAt: "2026-08-26T08:00:00Z",
}

const coca: Product = {
  id: "44444444-4444-4444-8444-444444444444",
  name: "Coca 50cl",
  barcode: "6191234567890",
  selling_price: "500.00",
  purchase_price: null,
  is_active: true,
  stock: 20,
  created_at: "2026-08-17T00:00:00Z",
  updated_at: "2026-08-17T00:00:00Z",
}

// Jamais recherché pendant la phase en ligne : le pilote ne le trouvait pas.
const biscuit: Product = {
  id: "55555555-5555-4555-8555-555555555555",
  name: "Biscuit Choco",
  barcode: "6199876543210",
  selling_price: "300.00",
  purchase_price: null,
  is_active: true,
  stock: 12,
  created_at: "2026-08-17T00:00:00Z",
  updated_at: "2026-08-17T00:00:00Z",
}

function renderPosOfflineAfterInit() {
  const queryClient = createQueryClient()
  queryClient.setQueryData(currentUserQueryKey, user)
  queryClient.setQueryData(["cash-registers"], [cashRegister])
  queryClient.setQueryData(
    ["cash-registers", cashRegister.id, "current-session"],
    cashSession,
  )
  queryClient.setQueryData(["stores", store.id], store)
  queryClient.setQueryData(["product-catalog", store.id], 2)
  // État exact du pilote : la lecture Dexie de la session locale a résolu
  // `null` avant l'ouverture de la caisse et reste figée (staleTime Infinity).
  queryClient.setQueryData(["local-cash-session", cashRegister.id], null)
  localStorage.setItem(SELECTED_CASH_REGISTER_KEY, cashRegister.id)

  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <PosPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(async () => {
  // Le catalogue et la session ont été synchronisés pendant la phase en ligne.
  await saveProductCatalog(store.id, [coca, biscuit])
  await db.cashSessions.put(openLocalSession)

  // Coupure réseau réelle : l'événement `offline` a été reçu (onlineManager
  // bascule) et navigator.onLine répond false ; toute requête fetch échoue.
  onlineManager.setOnline(false)
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false)
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"))
  vi.mocked(syncPendingSales).mockResolvedValue({ attempted: 0, synced: 0, conflicts: 0 })
})

afterEach(async () => {
  cleanup()
  onlineManager.setOnline(true)
  vi.clearAllMocks()
  vi.restoreAllMocks()
  localStorage.clear()
  await db.localSales.clear()
  await db.cashSessions.clear()
  await db.products.clear()
  await db.metadata.clear()
})

describe("POS résilience hors ligne (reproduction pilote)", () => {
  it("bug 1 : la première vente juste après la coupure réseau réussit sans refresh", async () => {
    const userEvents = userEvent.setup()
    renderPosOfflineAfterInit()

    const scanner = await screen.findByLabelText(
      "Scanner un code-barres ou rechercher par nom",
    )
    await userEvents.type(scanner, `${coca.barcode}{Enter}`)
    await waitFor(() =>
      expect(screen.getByLabelText(`Quantité de ${coca.name}`)).toHaveTextContent("1"),
    )

    await userEvents.click(screen.getByRole("button", { name: "Encaisser" }))
    await userEvents.click(screen.getByRole("button", { name: /Espèces/ }))
    await userEvents.type(screen.getByLabelText("Montant reçu"), "500")
    await userEvents.click(screen.getByRole("button", { name: "Valider" }))

    expect(await screen.findByRole("heading", { name: "Vente validée" })).toBeInTheDocument()

    // La vente est durable : persistée en PENDING_SYNC avec son event id.
    const sales = await db.localSales.toArray()
    expect(sales).toHaveLength(1)
    expect(sales[0]).toMatchObject({
      status: "PENDING_SYNC",
      cashSessionId: cashSession.id,
      total: 500,
    })
    expect(sales[0]!.syncEventId).toBeTruthy()

    // Et la synchronisation opportuniste a été déclenchée, sans passer par
    // un POST /sales/ dans le chemin d'encaissement.
    expect(syncPendingSales).toHaveBeenCalled()
    expect(
      vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes("/sales/")),
    ).toBe(false)

    // Le compteur de ventes en attente est visible pour le caissier.
    expect(
      await screen.findByText(/1 vente en attente de synchronisation/),
    ).toBeInTheDocument()
  })

  it("bug 2 : un produit jamais recherché est trouvé hors ligne par son nom", async () => {
    const userEvents = userEvent.setup()
    renderPosOfflineAfterInit()

    const scanner = await screen.findByLabelText(
      "Scanner un code-barres ou rechercher par nom",
    )
    await userEvents.type(scanner, "Biscuit")

    expect(
      await screen.findByRole("button", { name: `Ajouter ${biscuit.name} au panier` }),
    ).toBeInTheDocument()
  })

  it("bug 2 : un produit jamais recherché est trouvé hors ligne par son code-barres", async () => {
    const userEvents = userEvent.setup()
    renderPosOfflineAfterInit()

    const scanner = await screen.findByLabelText(
      "Scanner un code-barres ou rechercher par nom",
    )
    await userEvents.type(scanner, `${biscuit.barcode}{Enter}`)

    await waitFor(() =>
      expect(screen.getByLabelText(`Quantité de ${biscuit.name}`)).toHaveTextContent("1"),
    )
  })

  it("un échec de synchronisation ne transforme jamais une vente locale réussie en erreur", async () => {
    vi.mocked(syncPendingSales).mockRejectedValue(new Error("sync down"))
    const userEvents = userEvent.setup()
    renderPosOfflineAfterInit()

    const scanner = await screen.findByLabelText(
      "Scanner un code-barres ou rechercher par nom",
    )
    await userEvents.type(scanner, `${coca.barcode}{Enter}`)
    await waitFor(() =>
      expect(screen.getByLabelText(`Quantité de ${coca.name}`)).toHaveTextContent("1"),
    )

    await userEvents.click(screen.getByRole("button", { name: "Encaisser" }))
    await userEvents.click(screen.getByRole("button", { name: /Espèces/ }))
    await userEvents.type(screen.getByLabelText("Montant reçu"), "500")
    await userEvents.click(screen.getByRole("button", { name: "Valider" }))

    expect(await screen.findByRole("heading", { name: "Vente validée" })).toBeInTheDocument()
    expect(await db.localSales.count()).toBe(1)
  })
})
