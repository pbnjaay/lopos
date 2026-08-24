// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { afterEach, describe, expect, it, vi } from "vitest"

import { listConflictLocalSales, listPendingLocalSales } from "../db/sales"
import type { LocalSale } from "../db/types"
import { useSyncStatus } from "../features/sync/useSyncStatus"
import { PendingSalesPage } from "./PendingSalesPage"

vi.mock("../db/sales", () => ({
  listPendingLocalSales: vi.fn(),
  listConflictLocalSales: vi.fn(),
}))
vi.mock("../features/sync/useSyncStatus", () => ({ useSyncStatus: vi.fn() }))

function pendingSale(id: string, total: number): LocalSale {
  return {
    id,
    serverId: null,
    syncEventId: "sync-event-" + Math.random().toString(36).slice(2),
    cashSessionId: "session-id",
    storeId: "store-id",
    storeName: "Boutique",
    cashRegisterId: "register-id",
    cashRegisterName: "Caisse 01",
    cashierId: 1,
    cashierName: "Awa",
    createdAt: "2026-08-17T20:12:00Z",
    status: "PENDING_SYNC",
    conflictCode: null,
    conflictMessage: null,
    items: [],
    payment: { method: "CASH", amount: total, receivedAmount: total, changeAmount: 0 },
    subtotal: total,
    discount: 0,
    total,
  }
}

function conflictSale(id: string, total: number, message: string): LocalSale {
  return {
    ...pendingSale(id, total),
    status: "CONFLICT",
    conflictCode: "CASH_SESSION_CLOSED",
    conflictMessage: message,
  }
}

function mockSyncStatus(overrides: Partial<ReturnType<typeof useSyncStatus>> = {}) {
  vi.mocked(useSyncStatus).mockReturnValue({
    pendingCount: 0,
    conflictCount: 0,
    isSyncing: false,
    triggerSync: vi.fn().mockResolvedValue({ attempted: 0, synced: 0, conflicts: 0 }),
    ...overrides,
  })
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <PendingSalesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("PendingSalesPage", () => {
  it("lists each pending sale with a link to its ticket", async () => {
    mockSyncStatus()
    vi.mocked(listPendingLocalSales).mockResolvedValue([
      pendingSale("sale-1", 3_500),
      pendingSale("sale-2", 8_000),
    ])
    vi.mocked(listConflictLocalSales).mockResolvedValue([])

    renderPage()

    expect(await screen.findByText("3 500 FCFA")).toBeInTheDocument()
    expect(screen.getByText("8 000 FCFA")).toBeInTheDocument()
    const link = screen.getByText("3 500 FCFA").closest("a")
    expect(link).toHaveAttribute("href", "/sales/sale-1/receipt?from=pending")
  })

  it("shows an explicit empty state", async () => {
    mockSyncStatus()
    vi.mocked(listPendingLocalSales).mockResolvedValue([])
    vi.mocked(listConflictLocalSales).mockResolvedValue([])

    renderPage()

    expect(
      await screen.findByText("Aucune vente en attente de synchronisation."),
    ).toBeInTheDocument()
  })

  it("shows conflict sales separately with the server message", async () => {
    mockSyncStatus({ conflictCount: 1 })
    vi.mocked(listPendingLocalSales).mockResolvedValue([])
    vi.mocked(listConflictLocalSales).mockResolvedValue([
      conflictSale("sale-3", 1_500, "La session de caisse est fermée."),
    ])

    renderPage()

    expect(await screen.findByText("Ventes en conflit")).toBeInTheDocument()
    expect(screen.getByText("La session de caisse est fermée.")).toBeInTheDocument()
  })

  it("triggers a manual sync and refreshes the lists", async () => {
    const triggerSync = vi.fn().mockResolvedValue({ attempted: 1, synced: 1, conflicts: 0 })
    mockSyncStatus({ triggerSync })
    vi.mocked(listPendingLocalSales).mockResolvedValue([pendingSale("sale-1", 1_000)])
    vi.mocked(listConflictLocalSales).mockResolvedValue([])

    const userEvents = userEvent.setup()
    renderPage()
    await screen.findByText("1 000 FCFA")

    await userEvents.click(screen.getByRole("button", { name: "Synchroniser" }))

    expect(triggerSync).toHaveBeenCalledOnce()
  })

  it("disables the sync button while a sync is already running", async () => {
    mockSyncStatus({ isSyncing: true })
    vi.mocked(listPendingLocalSales).mockResolvedValue([])
    vi.mocked(listConflictLocalSales).mockResolvedValue([])

    renderPage()

    expect(await screen.findByRole("button", { name: "Synchronisation…" })).toBeDisabled()
  })
})
