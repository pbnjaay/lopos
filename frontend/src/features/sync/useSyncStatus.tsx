import { createContext, type PropsWithChildren, useContext, useEffect, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"

import { countConflictLocalSales } from "../../db/sales"
import { pendingSalesCountQueryKey, usePendingSalesCount } from "../offline/usePendingSalesCount"
import { syncPendingSales, type SyncOutcome } from "../../sync/syncEngine"

export const conflictSalesCountQueryKey = ["conflict-local-sales-count"] as const

type SyncStatus = {
  pendingCount: number
  conflictCount: number
  isSyncing: boolean
  lastOutcome: SyncOutcome | null
  triggerSync: () => Promise<SyncOutcome>
}

const SyncStatusContext = createContext<SyncStatus | null>(null)

function useSyncStatusState(active: boolean): SyncStatus {
  const queryClient = useQueryClient()
  const pendingCount = usePendingSalesCount(active)
  const conflictQuery = useQuery({
    queryKey: conflictSalesCountQueryKey,
    queryFn: () => countConflictLocalSales(),
    staleTime: 0,
    enabled: active,
  })
  const [isSyncing, setIsSyncing] = useState(false)
  const [lastOutcome, setLastOutcome] = useState<SyncOutcome | null>(null)

  async function runAndRefresh(): Promise<SyncOutcome> {
    setIsSyncing(true)
    try {
      const outcome = await syncPendingSales()
      if (outcome.synced > 0 || outcome.conflicts > 0) setLastOutcome(outcome)
      return outcome
    } catch {
      // Un échec de synchronisation n'est jamais une erreur pour l'appelant
      // (encaissement, montage, reconnexion) : les ventes restent
      // PENDING_SYNC et seront repoussées. L'exception est déjà remontée à
      // Sentry par le sync engine.
      return { attempted: 0, synced: 0, conflicts: 0 }
    } finally {
      setIsSyncing(false)
      void queryClient.invalidateQueries({ queryKey: pendingSalesCountQueryKey })
      void queryClient.invalidateQueries({ queryKey: conflictSalesCountQueryKey })
    }
  }

  useEffect(() => {
    if (!active) return
    // Runs once per mount (startup trigger) plus on every reconnect; syncPendingSales()
    // itself is mutex-guarded so overlapping triggers share a single in-flight run.
    void runAndRefresh()

    function handleOnline() {
      void runAndRefresh()
    }

    window.addEventListener("online", handleOnline)
    return () => window.removeEventListener("online", handleOnline)
  }, [active])

  return {
    pendingCount,
    conflictCount: conflictQuery.data ?? 0,
    isSyncing,
    lastOutcome,
    triggerSync: runAndRefresh,
  }
}

export function SyncStatusProvider({ children }: PropsWithChildren) {
  const status = useSyncStatusState(true)
  return <SyncStatusContext.Provider value={status}>{children}</SyncStatusContext.Provider>
}

export function useSyncStatus(): SyncStatus {
  const sharedStatus = useContext(SyncStatusContext)
  const localStatus = useSyncStatusState(sharedStatus === null)
  return sharedStatus ?? localStatus
}
