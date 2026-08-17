// @vitest-environment jsdom

import "fake-indexeddb/auto"

import { afterEach, describe, expect, it, vi } from "vitest"

import { NetworkError } from "../api/client"
import { pushSyncEvents } from "../api/sync"
import { db } from "../db/database"
import type { LocalSale } from "../db/types"
import { syncPendingSales } from "./syncEngine"

vi.mock("../api/sync", () => ({ pushSyncEvents: vi.fn() }))

// The backoff retry uses setTimeout(fn, >=1000ms); swallow only that so a leftover
// real timer from one test can't fire syncPendingSales() again mid-suite. Short
// delays (fake-indexeddb's own internal scheduling) still run for real.
const realSetTimeout = globalThis.setTimeout
vi.spyOn(globalThis, "setTimeout").mockImplementation(((
  handler: TimerHandler,
  timeout?: number,
  ...args: unknown[]
) => {
  if (typeof timeout === "number" && timeout >= 1_000) {
    return 0 as unknown as ReturnType<typeof setTimeout>
  }
  return realSetTimeout(handler as () => void, timeout, ...args)
}) as typeof setTimeout)

function buildPendingSale(id: string, syncEventId: string): LocalSale {
  return {
    id,
    serverId: null,
    syncEventId,
    cashSessionId: "session-id",
    storeId: "store-id",
    storeName: "Boutique",
    cashRegisterId: "register-id",
    cashRegisterName: "Caisse 01",
    cashierId: 1,
    cashierName: "Awa",
    createdAt: "2026-08-17T20:00:00Z",
    status: "PENDING_SYNC",
    conflictCode: null,
    conflictMessage: null,
    items: [
      {
        productId: "product-id",
        productName: "Coca 50cl",
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
}

afterEach(async () => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  await db.localSales.clear()
  await db.metadata.clear()
})

describe("syncPendingSales", () => {
  it("marks a sale SYNCED after a successful push", async () => {
    await db.localSales.add(buildPendingSale("sale-1", "event-1"))
    vi.mocked(pushSyncEvents).mockResolvedValue({
      results: [{ event_id: "event-1", status: "SYNCED", entity_id: "sale-1" }],
    })

    const outcome = await syncPendingSales()

    expect(outcome).toEqual({ attempted: 1, synced: 1, conflicts: 0 })
    const updated = await db.localSales.get("sale-1")
    expect(updated?.status).toBe("SYNCED")
    expect(updated?.serverId).toBe("sale-1")
  })

  it("leaves a sale PENDING_SYNC on a network error and reuses the same event id on retry", async () => {
    await db.localSales.add(buildPendingSale("sale-2", "event-2"))
    vi.mocked(pushSyncEvents).mockRejectedValueOnce(new NetworkError())

    const outcome = await syncPendingSales()

    expect(outcome).toEqual({ attempted: 0, synced: 0, conflicts: 0 })
    const stillPending = await db.localSales.get("sale-2")
    expect(stillPending?.status).toBe("PENDING_SYNC")
    expect(stillPending?.syncEventId).toBe("event-2")

    vi.mocked(pushSyncEvents).mockResolvedValueOnce({
      results: [{ event_id: "event-2", status: "SYNCED", entity_id: "sale-2" }],
    })
    await syncPendingSales()

    const synced = await db.localSales.get("sale-2")
    expect(synced?.status).toBe("SYNCED")
    const retryCall = vi.mocked(pushSyncEvents).mock.calls[1]!
    expect(retryCall[1][0]?.event_id).toBe("event-2")
  })

  it("treats ALREADY_PROCESSED as a successful sync, not an error", async () => {
    await db.localSales.add(buildPendingSale("sale-3", "event-3"))
    vi.mocked(pushSyncEvents).mockResolvedValue({
      results: [{ event_id: "event-3", status: "ALREADY_PROCESSED", entity_id: "sale-3" }],
    })

    const outcome = await syncPendingSales()

    expect(outcome).toEqual({ attempted: 1, synced: 1, conflicts: 0 })
    expect((await db.localSales.get("sale-3"))?.status).toBe("SYNCED")
  })

  it.each(["CONFLICT", "REJECTED"] as const)(
    "marks a %s result as CONFLICT and never resends it automatically",
    async (status) => {
      await db.localSales.add(buildPendingSale("sale-4", "event-4"))
      vi.mocked(pushSyncEvents).mockResolvedValue({
        results: [
          {
            event_id: "event-4",
            status,
            code: "CASH_SESSION_CLOSED",
            message: "La session de caisse est fermée.",
          },
        ],
      })

      await syncPendingSales()

      const updated = await db.localSales.get("sale-4")
      expect(updated?.status).toBe("CONFLICT")
      expect(updated?.conflictCode).toBe("CASH_SESSION_CLOSED")
      expect(updated?.conflictMessage).toBe("La session de caisse est fermée.")

      vi.mocked(pushSyncEvents).mockClear()
      await syncPendingSales()
      expect(pushSyncEvents).not.toHaveBeenCalled()
    },
  )

  it("runs a single batch when two triggers overlap", async () => {
    await db.localSales.add(buildPendingSale("sale-5", "event-5"))
    let resolvePush!: (value: Awaited<ReturnType<typeof pushSyncEvents>>) => void
    vi.mocked(pushSyncEvents).mockReturnValue(
      new Promise((resolve) => {
        resolvePush = resolve
      }),
    )

    const first = syncPendingSales()
    const second = syncPendingSales()
    expect(first).toBe(second)

    resolvePush({ results: [{ event_id: "event-5", status: "SYNCED", entity_id: "sale-5" }] })
    await first
    await second

    expect(pushSyncEvents).toHaveBeenCalledOnce()
  })

  it("converges to SYNCED without duplicating the sale after a crash before the local write", async () => {
    // Simulates restarting after the server accepted the event but the app crashed
    // before persisting that locally: the sale is still PENDING_SYNC on this run.
    await db.localSales.add(buildPendingSale("sale-6", "event-6"))
    vi.mocked(pushSyncEvents).mockResolvedValue({
      results: [{ event_id: "event-6", status: "ALREADY_PROCESSED", entity_id: "sale-6" }],
    })

    await syncPendingSales()

    const rows = await db.localSales.where("id").equals("sale-6").toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.status).toBe("SYNCED")
    expect(rows[0]?.serverId).toBe("sale-6")
  })

  it("does nothing while offline", async () => {
    vi.stubGlobal("navigator", { onLine: false })
    await db.localSales.add(buildPendingSale("sale-7", "event-7"))

    const outcome = await syncPendingSales()

    expect(outcome).toEqual({ attempted: 0, synced: 0, conflicts: 0 })
    expect(pushSyncEvents).not.toHaveBeenCalled()
    expect((await db.localSales.get("sale-7"))?.status).toBe("PENDING_SYNC")
  })
})
