import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "react-router-dom"

import { listConflictLocalSales, listPendingLocalSales } from "../db/sales"
import { useNetworkStatus } from "../features/offline/useNetworkStatus"
import { useSyncStatus } from "../features/sync/useSyncStatus"
import { formatDateTime } from "../utils/date"
import { formatMoney } from "../utils/money"

const paymentLabels = {
  CASH: "Espèces",
  WAVE: "Wave",
  ORANGE_MONEY: "Orange Money",
} as const

const pendingSalesQueryKey = ["pending-local-sales"] as const
const conflictSalesQueryKey = ["conflict-local-sales"] as const

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

  async function handleSyncClick() {
    await triggerSync()
    void queryClient.invalidateQueries({ queryKey: pendingSalesQueryKey })
    void queryClient.invalidateQueries({ queryKey: conflictSalesQueryKey })
  }

  return (
    <main className="content-page">
      <section className="setup-card" aria-labelledby="pending-sales-title">
        <p className="eyebrow">Hors ligne</p>
        <h1 id="pending-sales-title">Ventes en attente</h1>
        <p className="muted">
          Ces ventes ont été enregistrées localement et seront synchronisées dès la
          reconnexion.
        </p>

        <button
          className="button button-secondary"
          type="button"
          disabled={!isOnline || isSyncing}
          onClick={() => void handleSyncClick()}
        >
          {isSyncing ? "Synchronisation…" : "Synchroniser"}
        </button>
        {!isOnline ? (
          <p className="muted">Reconnectez-vous pour synchroniser.</p>
        ) : null}

        {isLoading ? <p className="muted">Chargement…</p> : null}

        {!isLoading && conflicts.length > 0 ? (
          <>
            <h2>Ventes en conflit</h2>
            <p className="muted">
              Ces ventes ont été refusées par le serveur et ne seront pas renvoyées
              automatiquement.
            </p>
            <ul className="pending-sales-list">
              {conflicts.map((sale) => (
                <li key={sale.id}>
                  <Link
                    className="pending-sale-row pending-sale-row-conflict"
                    to={`/sales/${encodeURIComponent(sale.id)}/receipt`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <span>{formatDateTime(sale.createdAt)}</span>
                    <strong>{formatMoney(sale.total)}</strong>
                    <span>{sale.conflictMessage}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        ) : null}

        {!isLoading && sales.length === 0 ? (
          <p className="muted">Aucune vente en attente de synchronisation.</p>
        ) : null}

        {sales.length > 0 ? (
          <ul className="pending-sales-list">
            {sales.map((sale) => (
              <li key={sale.id}>
                <Link
                  className="pending-sale-row"
                  to={`/sales/${encodeURIComponent(sale.id)}/receipt`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <span>{formatDateTime(sale.createdAt)}</span>
                  <strong>{formatMoney(sale.total)}</strong>
                  <span>{paymentLabels[sale.payment.method]}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : null}

        <Link className="text-button" to="/pos">
          Retour au point de vente
        </Link>
      </section>
    </main>
  )
}
