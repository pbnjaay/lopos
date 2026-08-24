import { isApiUnavailable } from "../api/client"
import { pushSyncEvents, type SyncEvent, type SyncResult } from "../api/sync"
import {
  trackSyncCompleted,
  trackSyncConflict,
  trackSyncFailed,
  trackSyncStarted,
} from "../analytics/events"
import { Sentry } from "../analytics/sentry"
import {
  listPendingLocalSales,
  markLocalSaleConflict,
  markLocalSaleSynced,
} from "../db/sales"
import { getOrCreateTerminalId } from "../db/terminal"
import type { LocalSale } from "../db/types"
import { isNavigatorOnline } from "../utils/network"
import { toBackendMoney } from "../utils/money"
import { milliToBackendQuantity } from "../utils/quantity"

const BATCH_SIZE = 50
const BACKOFF_STEPS_MS = [1_000, 2_000, 5_000, 10_000]

export type SyncOutcome = {
  attempted: number
  synced: number
  conflicts: number
}

const EMPTY_OUTCOME: SyncOutcome = { attempted: 0, synced: 0, conflicts: 0 }

let syncInProgress: Promise<SyncOutcome> | null = null
let consecutiveFailures = 0
let retryTimer: ReturnType<typeof setTimeout> | null = null

function toSyncEvent(sale: LocalSale): SyncEvent {
  return {
    event_id: sale.syncEventId,
    type: "SALE_COMPLETED",
    entity_id: sale.id,
    occurred_at: sale.createdAt,
    payload: {
      cash_session_id: sale.cashSessionId,
      items: sale.items.map((item) => ({
        product_id: item.productId,
        product_name: item.productName,
        unit_price: toBackendMoney(item.unitPrice),
        ...(item.catalogUnitPrice ? { catalog_unit_price: toBackendMoney(item.catalogUnitPrice) } : {}),
        quantity: milliToBackendQuantity(item.quantityMilli ?? (item.quantity ?? 0) * 1000),
      })),
      payment:
        sale.payment.method === "CASH"
          ? { method: "CASH", received_amount: toBackendMoney(sale.payment.receivedAmount ?? 0) }
          : { method: sale.payment.method },
    },
  }
}

async function applyResult(sale: LocalSale, result: SyncResult | undefined): Promise<"synced" | "conflict" | "pending"> {
  if (!result) return "pending"

  if (result.status === "SYNCED" || result.status === "ALREADY_PROCESSED") {
    await markLocalSaleSynced(sale.id, result.entity_id ?? sale.id)
    return "synced"
  }

  await markLocalSaleConflict(sale.id, {
    code: result.code ?? "UNKNOWN",
    message: result.message ?? "Conflit de synchronisation.",
  })
  return "conflict"
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

async function pushBatch(terminalId: string, sales: LocalSale[]): Promise<SyncOutcome> {
  const response = await pushSyncEvents(terminalId, sales.map(toSyncEvent))
  const resultsByEventId = new Map(response.results.map((result) => [result.event_id, result]))

  let synced = 0
  let conflicts = 0
  for (const sale of sales) {
    const outcome = await applyResult(sale, resultsByEventId.get(sale.syncEventId))
    if (outcome === "synced") synced += 1
    if (outcome === "conflict") conflicts += 1
  }
  return { attempted: sales.length, synced, conflicts }
}

function getBackoffDelayMs(): number {
  const index = Math.min(consecutiveFailures, BACKOFF_STEPS_MS.length - 1)
  return BACKOFF_STEPS_MS[index]!
}

function scheduleRetry(): void {
  if (retryTimer) return
  retryTimer = setTimeout(() => {
    retryTimer = null
    void syncPendingSales()
  }, getBackoffDelayMs())
}

async function runSync(): Promise<SyncOutcome> {
  if (!isNavigatorOnline()) return EMPTY_OUTCOME

  const pending = await listPendingLocalSales()
  if (pending.length === 0) {
    consecutiveFailures = 0
    return EMPTY_OUTCOME
  }

  const terminalId = await getOrCreateTerminalId()
  const startedAt = Date.now()
  trackSyncStarted({ pending_count: pending.length })
  let attempted = 0
  let synced = 0
  let conflicts = 0
  let networkFailure = false

  for (const batch of chunk(pending, BATCH_SIZE)) {
    try {
      const outcome = await pushBatch(terminalId, batch)
      attempted += outcome.attempted
      synced += outcome.synced
      conflicts += outcome.conflicts
      consecutiveFailures = 0
    } catch (error) {
      if (!isApiUnavailable(error)) {
        Sentry.captureException(error, { tags: { sync_event_id: terminalId } })
        throw error
      }
      // Network/5xx failure: the remaining batches stay PENDING_SYNC and are retried with backoff.
      consecutiveFailures += 1
      networkFailure = true
      // Only report once the backoff has maxed out — a single isolated retry is normal, not a failure.
      if (consecutiveFailures >= BACKOFF_STEPS_MS.length) {
        trackSyncFailed({ pending_count: pending.length - attempted })
      }
      scheduleRetry()
      break
    }
  }

  if (conflicts > 0) trackSyncConflict({ conflict_count: conflicts })
  if (!networkFailure) {
    trackSyncCompleted({
      pending_count: pending.length,
      processed_count: synced,
      conflict_count: conflicts,
      duration_ms: Date.now() - startedAt,
    })
  }

  return { attempted, synced, conflicts }
}

/** At most one sync runs at a time; concurrent callers share the in-flight result. */
export function syncPendingSales(): Promise<SyncOutcome> {
  if (!syncInProgress) {
    syncInProgress = runSync().finally(() => {
      syncInProgress = null
    })
  }
  return syncInProgress
}

export function isSyncPendingSalesRunning(): boolean {
  return syncInProgress !== null
}
