import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "react-router-dom"

import { OperationalPageHeader } from "../components/layout/OperationalPageHeader"
import { EmptyState } from "../components/ui/EmptyState"
import { listConflictLocalSales, listPendingLocalSales } from "../db/sales"
import { useNetworkStatus } from "../features/offline/useNetworkStatus"
import { useSyncStatus } from "../features/sync/useSyncStatus"
import type { SyncOutcome } from "../sync/syncEngine"
import { formatDateTime } from "../utils/date"
import { formatMoney } from "../utils/money"

const paymentLabels = {
  CASH: "Espèces",
  WAVE: "Wave",
  ORANGE_MONEY: "Orange Money",
} as const

const pendingSalesQueryKey = ["pending-local-sales"] as const
const conflictSalesQueryKey = ["conflict-local-sales"] as const

function describeSyncOutcome(outcome: SyncOutcome): string {
  if (outcome.attempted === 0) return "Aucune vente à synchroniser."
  if (outcome.conflicts > 0) {
    return `${outcome.synced} vente${outcome.synced > 1 ? "s" : ""} synchronisée${outcome.synced > 1 ? "s" : ""}, ${outcome.conflicts} en conflit.`
  }
  return `${outcome.synced} vente${outcome.synced > 1 ? "s" : ""} synchronisée${outcome.synced > 1 ? "s" : ""}.`
}

export function PendingSalesPage() {
  const isOnline = useNetworkStatus()
  const { isSyncing, triggerSync } = useSyncStatus()
  const queryClient = useQueryClient()
  const pendingSalesQuery = useQuery({
    queryKey: pendingSalesQueryKey,
    queryFn: () => listPendingLocalSales(),
  })
  const conflictSalesQuery = useQuery({
    queryKey: conflictSalesQueryKey,
    queryFn: () => listConflictLocalSales(),
  })
  const sales = pendingSalesQuery.data ?? []
  const conflicts = conflictSalesQuery.data ?? []
  const isLoading = pendingSalesQuery.isLoading || conflictSalesQuery.isLoading
  const [syncResultMessage, setSyncResultMessage] = useState<string | null>(null)

  async function handleSyncClick() {
    setSyncResultMessage(null)
    const outcome = await triggerSync()
    void queryClient.invalidateQueries({ queryKey: pendingSalesQueryKey })
    void queryClient.invalidateQueries({ queryKey: conflictSalesQueryKey })
    setSyncResultMessage(describeSyncOutcome(outcome))
  }

  return (
    <main className="operational-page">
      <OperationalPageHeader
        backTo="/pos"
        backLabel="Retour au point de vente"
        eyebrow="Synchronisation locale"
        title="Ventes en attente"
        context={isLoading ? "Vérification en cours" : `${sales.length} en attente · ${conflicts.length} en conflit`}
        actions={(
          <button
            className="button button-primary button-small"
            type="button"
            disabled={!isOnline || isSyncing}
            onClick={() => void handleSyncClick()}
          >
            {isSyncing ? "Synchronisation…" : "Synchroniser"}
          </button>
        )}
      />

      <section className="operational-card pending-sales-card" aria-label="État de la synchronisation">
        <div className="section-introduction">
          <h2>Synchronisation des ventes</h2>
          <p>Les ventes locales sont envoyées automatiquement dès que la connexion revient.</p>
        </div>
        {!isOnline ? (
          <p className="pending-sales-notice">Reconnectez-vous pour lancer la synchronisation.</p>
        ) : null}
        {syncResultMessage ? (
          <p className="form-success" role="status">
            {syncResultMessage}
          </p>
        ) : null}

        {isLoading ? <p className="muted">Chargement…</p> : null}

        {!isLoading && conflicts.length > 0 ? (
          <section className="pending-sales-section" aria-labelledby="conflict-sales-title">
            <h2 id="conflict-sales-title">Ventes en conflit</h2>
            <p className="muted">
              Ces ventes ont été refusées par le serveur et ne seront pas renvoyées
              automatiquement.
            </p>
            <ul className="pending-sales-list">
              {conflicts.map((sale) => (
                <li key={sale.id}>
                  <Link
                    className="pending-sale-row pending-sale-row-conflict"
                    to={`/sales/${encodeURIComponent(sale.id)}/receipt?from=pending`}
                  >
                    <span>{formatDateTime(sale.createdAt)}</span>
                    <strong>{formatMoney(sale.total)}</strong>
                    <span>{sale.conflictMessage}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {!isLoading && sales.length === 0 && conflicts.length === 0 ? (
          <EmptyState
            title="Aucune vente en attente de synchronisation."
            description="Toutes les ventes locales ont été envoyées au serveur."
          />
        ) : null}

        {sales.length > 0 ? (
          <section className="pending-sales-section" aria-labelledby="pending-sync-title">
            <h2 id="pending-sync-title">À synchroniser</h2>
            <ul className="pending-sales-list">
              {sales.map((sale) => (
                <li key={sale.id}>
                  <Link
                    className="pending-sale-row"
                    to={`/sales/${encodeURIComponent(sale.id)}/receipt?from=pending`}
                  >
                    <span>{formatDateTime(sale.createdAt)}</span>
                    <strong>{formatMoney(sale.total)}</strong>
                    <span>{paymentLabels[sale.payment.method]}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </section>
    </main>
  )
}
