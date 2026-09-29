// @vitest-environment jsdom

import "fake-indexeddb/auto"
import "@testing-library/jest-dom/vitest"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { db } from "../../db/database"
import type { LocalCashSession } from "../../db/types"
import { CashContextLabel } from "./CashContextLabel"
import { invalidateLocalCashSessionQueries } from "./queries"

vi.mock("../offline/useNetworkStatus", () => ({ useNetworkStatus: () => false }))

const session: LocalCashSession = {
  id: "session-id",
  cashRegisterId: "register-id",
  cashRegisterName: "Caisse 01",
  storeId: "store-id",
  storeName: "Supérette Test",
  cashierId: 7,
  cashierName: "Awa",
  openingBalance: 0,
  openedAt: new Date(Date.now() - 47 * 60_000).toISOString(),
  status: "OPEN",
  cachedAt: new Date().toISOString(),
}

function renderLabel() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <CashContextLabel />
    </QueryClientProvider>,
  )
}

afterEach(async () => {
  cleanup()
  localStorage.clear()
  await db.cashSessions.clear()
})

describe("CashContextLabel", () => {
  it("names the store, the register and the opening time", async () => {
    localStorage.setItem("lopos.selectedCashRegisterId", "register-id")
    await db.cashSessions.put(session)

    renderLabel()

    expect(await screen.findByText("Supérette Test")).toBeInTheDocument()
    expect(screen.getByText(/Caisse 01/)).toBeInTheDocument()
    expect(screen.getByText(/ouverte depuis 47 min/)).toBeInTheDocument()
  })

  it("still shows up when no register was ever remembered on this device", async () => {
    // Navigateur neuf, boutique à caisse unique, session déjà ouverte : l'app
    // choisit la caisse d'elle-même et va au POS sans jamais la mémoriser.
    await db.cashSessions.put(session)

    renderLabel()

    expect(await screen.findByText("Supérette Test")).toBeInTheDocument()
    expect(screen.getByText(/Caisse 01/)).toBeInTheDocument()
  })
})

describe("CashContextLabel freshness", () => {
  it("appears as soon as the session is written locally, without waiting for its periodic re-read", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <CashContextLabel />
      </QueryClientProvider>,
    )
    // Rien en local au montage de l'en-tête (poste neuf).
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.queryByText("Supérette Test")).not.toBeInTheDocument()

    await db.cashSessions.put(session)
    await invalidateLocalCashSessionQueries(queryClient)

    expect(await screen.findByText("Supérette Test", {}, { timeout: 1000 })).toBeInTheDocument()
  })
})
