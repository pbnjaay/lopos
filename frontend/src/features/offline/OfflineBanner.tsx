import { useNetworkStatus } from "./useNetworkStatus"

type OfflineBannerProps = {
  pendingSalesCount?: number
  conflictSalesCount?: number
  isSyncing?: boolean
}

export function OfflineBanner({
  pendingSalesCount = 0,
  conflictSalesCount = 0,
  isSyncing = false,
}: OfflineBannerProps) {
  const isOnline = useNetworkStatus()

  return (
    <div
      className={`network-status ${isOnline ? "network-status-online" : "network-status-offline"}`}
      role="status"
    >
      <span className="network-status-dot" aria-hidden="true" />
      <span>{isOnline ? "En ligne" : "Hors ligne"}</span>
      {!isOnline ? (
        <span className="network-status-detail">Les ventes sont enregistrées localement.</span>
      ) : null}
      {isSyncing ? <span className="network-status-pending">Synchronisation…</span> : null}
      {!isSyncing && pendingSalesCount > 0 ? (
        <span className="network-status-pending">
          {pendingSalesCount} vente{pendingSalesCount > 1 ? "s" : ""} en attente de synchronisation
        </span>
      ) : null}
      {conflictSalesCount > 0 ? (
        <span className="network-status-conflict">
          {conflictSalesCount} vente{conflictSalesCount > 1 ? "s" : ""} en conflit
        </span>
      ) : null}
    </div>
  )
}
