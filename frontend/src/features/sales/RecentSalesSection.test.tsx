// @vitest-environment jsdom

import "fake-indexeddb/auto"
import "@testing-library/jest-dom/vitest"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { afterEach, describe, expect, it } from "vitest"

import { db } from "../../db/database"
import type { LocalSale } from "../../db/types"
import { RecentSalesSection } from "./RecentSalesSection"

function buildSale(id: string, createdAt: string, total: number): LocalSale {
  return {
    id,
    serverId: null,
    syncEventId: `event-${id}`,
    cashSessionId: "session-a",
    storeId: "store-a",
    storeName: "Supérette Test",
    cashRegisterId: "register-a",
    cashRegisterName: "Caisse 01",
    cashierId: 7,
    cashierName: "Awa",
    createdAt,
    status: "PENDING_SYNC",
    conflictCode: null,
    conflictMessage: null,
    items: [
      {
        productId: "coca",
        productName: "Coca 50cl",
        unitPrice: total,
        quantityMilli: 1000,
        lineTotal: total,
      },
    ],
    payment: { method: "CASH", amount: total, receivedAmount: total, changeAmount: 0 },
    subtotal: total,
    discount: 0,
    total,
  }
}

function renderSection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <RecentSalesSection cashSessionId="session-a" />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(async () => {
  cleanup()
  await db.localSales.clear()
})

describe("RecentSalesSection", () => {
  it("n'occupe aucune place tant qu'aucune vente n'a été encaissée", async () => {
    renderSection()
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "Dernières ventes" })).not.toBeInTheDocument(),
    )
  })

  it("montre les trois dernières ventes, la plus récente d'abord", async () => {
    await db.localSales.bulkPut([
      buildSale("sale-1", "2026-08-30T10:00:00Z", 1_000),
      buildSale("sale-2", "2026-08-30T11:00:00Z", 2_000),
      buildSale("sale-3", "2026-08-30T12:00:00Z", 3_000),
      buildSale("sale-4", "2026-08-30T13:00:00Z", 4_000),
    ])

    renderSection()

    const rows = await screen.findAllByRole("link", { name: /Vente de/ })
    expect(rows).toHaveLength(3)
    // La plus récente en tête, et la plus ancienne des quatre écartée.
    expect(rows[0]).toHaveTextContent("4 000 FCFA")
    expect(rows[2]).toHaveTextContent("2 000 FCFA")
    // Vente non synchronisée : le serveur ne la connaît pas encore, seul le
    // ticket local est consultable — et il l'est hors ligne.
    expect(rows[0]).toHaveAttribute("href", "/sales/sale-4/receipt?from=pos")
  })

  it("ouvre le détail de la vente une fois celle-ci synchronisée", async () => {
    await db.localSales.put({
      ...buildSale("sale-local", "2026-08-30T14:00:00Z", 5_000),
      status: "SYNCED",
      serverId: "sale-server",
    })

    renderSection()

    const row = await screen.findByRole("link", { name: /Vente de/ })
    // La provenance voyage avec le lien : depuis la caisse, « retour »
    // ramène à la caisse, pas à la liste des ventes.
    expect(row).toHaveAttribute("href", "/sales/sale-server?from=pos")
  })
})
