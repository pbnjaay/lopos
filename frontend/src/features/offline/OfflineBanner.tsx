import { useNetworkStatus } from "./useNetworkStatus"

type OfflineBannerProps = {
  pendingSalesCount?: number
}

export function OfflineBanner({ pendingSalesCount = 0 }: OfflineBannerProps) {
  const isOnline = useNetworkStatus()
  const showPending = pendingSalesCount > 0

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
      {showPending ? (
        <span className="network-status-pending">
          {pendingSalesCount} vente{pendingSalesCount > 1 ? "s" : ""} en attente de synchronisation
        </span>
      ) : null}
    </div>
  )
}
