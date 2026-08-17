// @vitest-environment jsdom

import "fake-indexeddb/auto"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { db } from "../../db/database"
import type { LocalSale } from "../../db/types"
import { usePendingSalesCount } from "./usePendingSalesCount"

function pendingSale(id: string): LocalSale {
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
    createdAt: "2026-08-17T20:00:00Z",
    status: "PENDING_SYNC",
    items: [],
    payment: { method: "CASH", amount: 0, receivedAmount: 0, changeAmount: 0 },
    subtotal: 0,
    discount: 0,
    total: 0,
  }
}

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

afterEach(async () => {
  await db.localSales.clear()
})

describe("usePendingSalesCount", () => {
  it("counts sales awaiting sync", async () => {
    await db.localSales.bulkAdd([pendingSale("sale-1"), pendingSale("sale-2")])

    const { result } = renderHook(() => usePendingSalesCount(), { wrapper })

    await waitFor(() => expect(result.current).toBe(2))
  })

  it("defaults to zero while nothing is queued", async () => {
    const { result } = renderHook(() => usePendingSalesCount(), { wrapper })

    await waitFor(() => expect(result.current).toBe(0))
  })
})
