import { useNetworkStatus } from "./useNetworkStatus"
import { WifiIcon, WifiOffIcon } from "../../components/ui/Icons"

type OfflineBannerProps = {
  pendingSalesCount?: number
  conflictSalesCount?: number
  isSyncing?: boolean
}

export function ConnectionStatus() {
  const isOnline = useNetworkStatus()

  return (
    <div
      className={`network-status app-network-status ${isOnline ? "network-status-online" : "network-status-offline"}`}
      role="status"
      aria-label={isOnline ? "Connexion Internet disponible" : "Sans connexion Internet"}
      title={isOnline ? "Connexion Internet disponible" : "Sans connexion Internet"}
    >
      {isOnline ? <WifiIcon /> : <WifiOffIcon />}
      {!isOnline ? <span>Hors ligne</span> : null}
    </div>
  )
}

export function OfflineBanner({
  pendingSalesCount = 0,
  conflictSalesCount = 0,
  isSyncing = false,
}: OfflineBannerProps) {
  const isOnline = useNetworkStatus()
  const hasOperationalStatus = !isOnline || isSyncing || pendingSalesCount > 0 || conflictSalesCount > 0

  if (!hasOperationalStatus) return null

  return (
    <div
      className={`network-status network-operation-status ${isOnline ? "network-status-online" : "network-status-offline"}`}
      role="status"
    >
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
