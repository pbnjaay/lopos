import { useEffect, useRef } from "react"
import { Link } from "react-router-dom"

import { useToast } from "../../components/ui/Toast"
import { useSyncStatus } from "../sync/useSyncStatus"
import { useNetworkStatus } from "./useNetworkStatus"
import { WifiIcon, WifiOffIcon } from "../../components/ui/Icons"

/**
 * Statut permanent du réseau — jamais un toast, jamais une bannière rouge :
 * le POS fonctionne hors ligne, l'état réseau est une information de fond.
 */
export function ConnectionStatus() {
  const isOnline = useNetworkStatus()
  const { pendingCount, conflictCount, isSyncing } = useSyncStatus()
  const hasDetails = pendingCount > 0 || conflictCount > 0
  const label = conflictCount > 0
    ? `${conflictCount} vente${conflictCount > 1 ? "s" : ""} à vérifier`
    : isSyncing
      ? `Synchronisation…${pendingCount > 0 ? ` · ${pendingCount}` : ""}`
      : isOnline
        ? pendingCount > 0
          ? `En ligne · ${pendingCount} en attente`
          : "En ligne"
        : pendingCount > 0
          ? `Hors ligne · ${pendingCount} en attente`
          : "Hors ligne"
  const stateClass = conflictCount > 0
    ? "network-status-attention"
    : isOnline
      ? "network-status-online"
      : "network-status-offline"
  const visibleLabel = !isOnline && !isSyncing && conflictCount === 0 && pendingCount > 0
    ? <span>Hors ligne · {pendingCount}<span className="network-pending-suffix"> en attente</span></span>
    : <span>{label}</span>

  const content = (
    <>
      {isOnline ? <WifiIcon /> : <WifiOffIcon />}
      {visibleLabel}
    </>
  )

  if (hasDetails) {
    return (
      <Link
        className={`network-status app-network-status ${stateClass}`}
        to="/sales/pending"
        aria-label={label}
        title={label}
      >
        {content}
      </Link>
    )
  }

  return (
    <div
      className={`network-status app-network-status ${stateClass}`}
      role="status"
      aria-label={label}
      title={label}
    >
      {content}
    </div>
  )
}

/**
 * Événements réseau et synchronisation — servis par le système de toasts
 * commun, donc empilés, dédupliqués et expirés selon les mêmes règles que
 * le reste de l'application.
 */
export function NetworkNotifications() {
  const isOnline = useNetworkStatus()
  const { lastOutcome } = useSyncStatus()
  const toast = useToast()
  const previousOnline = useRef(isOnline)
  const previousOutcome = useRef(lastOutcome)
  const wasOffline = useRef(!isOnline)

  useEffect(() => {
    if (previousOnline.current && !isOnline) {
      wasOffline.current = true
      // Le POS continue de vendre : ce n'est pas une erreur, c'est un
      // changement de mode, et le message dit ce qui reste possible.
      toast.info("Mode hors ligne activé", {
        description: "Vous pouvez continuer à vendre, les ventes sont enregistrées sur la caisse.",
      })
    }
    previousOnline.current = isOnline
  }, [isOnline, toast])

  useEffect(() => {
    if (lastOutcome && lastOutcome !== previousOutcome.current) {
      if (lastOutcome.conflicts > 0) {
        toast.warning(
          `${lastOutcome.conflicts} vente${lastOutcome.conflicts > 1 ? "s" : ""} à vérifier`,
          {
            description: `${lastOutcome.synced} vente${lastOutcome.synced !== 1 ? "s" : ""} synchronisée${lastOutcome.synced !== 1 ? "s" : ""}.`,
          },
        )
      } else if (isOnline && wasOffline.current) {
        toast.success("Synchronisation terminée", {
          description:
            lastOutcome.synced === 1
              ? "1 vente a été envoyée au serveur."
              : `${lastOutcome.synced} ventes ont été envoyées au serveur.`,
        })
        wasOffline.current = false
      }
    }
    previousOutcome.current = lastOutcome
  }, [isOnline, lastOutcome, toast])

  return null
}
