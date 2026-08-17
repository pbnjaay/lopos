// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { afterEach, describe, expect, it, vi } from "vitest"

import { listPendingLocalSales } from "../db/sales"
import type { LocalSale } from "../db/types"
import { PendingSalesPage } from "./PendingSalesPage"

vi.mock("../db/sales", () => ({ listPendingLocalSales: vi.fn() }))

function pendingSale(id: string, total: number): LocalSale {
  return {
    id,
    serverId: null,
    cashSessionId: "session-id",
    storeId: "store-id",
    storeName: "Boutique",
    cashRegisterId: "register-id",
    cashRegisterName: "Caisse 01",
    cashierId: 1,
    cashierName: "Awa",
    createdAt: "2026-08-17T20:12:00Z",
    status: "PENDING_SYNC",
    items: [],
    payment: { method: "CASH", amount: total, receivedAmount: total, changeAmount: 0 },
    subtotal: total,
    discount: 0,
    total,
  }
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
    vi.mocked(listPendingLocalSales).mockResolvedValue([
      pendingSale("sale-1", 3_500),
      pendingSale("sale-2", 8_000),
    ])

    renderPage()

    expect(await screen.findByText("3 500 FCFA")).toBeInTheDocument()
    expect(screen.getByText("8 000 FCFA")).toBeInTheDocument()
    const link = screen.getByText("3 500 FCFA").closest("a")
    expect(link).toHaveAttribute("href", "/sales/sale-1/receipt")
  })

  it("shows an explicit empty state", async () => {
    vi.mocked(listPendingLocalSales).mockResolvedValue([])

    renderPage()

    expect(
      await screen.findByText("Aucune vente en attente de synchronisation."),
    ).toBeInTheDocument()
  })
})
