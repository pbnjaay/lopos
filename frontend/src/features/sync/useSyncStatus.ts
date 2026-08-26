import { useEffect, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"

import { countConflictLocalSales } from "../../db/sales"
import { pendingSalesCountQueryKey, usePendingSalesCount } from "../offline/usePendingSalesCount"
import { syncPendingSales, type SyncOutcome } from "../../sync/syncEngine"

export const conflictSalesCountQueryKey = ["conflict-local-sales-count"] as const

export function useSyncStatus() {
  const queryClient = useQueryClient()
  const pendingCount = usePendingSalesCount()
  const conflictQuery = useQuery({
    queryKey: conflictSalesCountQueryKey,
    queryFn: () => countConflictLocalSales(),
    staleTime: 0,
  })
  const [isSyncing, setIsSyncing] = useState(false)

  async function runAndRefresh(): Promise<SyncOutcome> {
    setIsSyncing(true)
    try {
      return await syncPendingSales()
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
    // Runs once per mount (startup trigger) plus on every reconnect; syncPendingSales()
    // itself is mutex-guarded so overlapping triggers share a single in-flight run.
    void runAndRefresh()

    function handleOnline() {
      void runAndRefresh()
    }

    window.addEventListener("online", handleOnline)
    return () => window.removeEventListener("online", handleOnline)
  }, [])

  return {
    pendingCount,
    conflictCount: conflictQuery.data ?? 0,
    isSyncing,
    triggerSync: runAndRefresh,
  }
}
