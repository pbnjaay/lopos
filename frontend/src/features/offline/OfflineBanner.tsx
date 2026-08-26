import { useEffect, useRef, useState } from "react"
import { Link } from "react-router-dom"

import { useSyncStatus } from "../sync/useSyncStatus"
import { useNetworkStatus } from "./useNetworkStatus"
import { WifiIcon, WifiOffIcon } from "../../components/ui/Icons"

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

export function NetworkNotifications() {
  const isOnline = useNetworkStatus()
  const { lastOutcome } = useSyncStatus()
  const previousOnline = useRef(isOnline)
  const previousOutcome = useRef(lastOutcome)
  const wasOffline = useRef(!isOnline)
  const [message, setMessage] = useState<{
    title: string
    detail?: string
    tone: "warning" | "success"
  } | null>(null)

  useEffect(() => {
    if (previousOnline.current && !isOnline) {
      wasOffline.current = true
      setMessage({
        title: "Connexion perdue",
        detail: "Les ventes continueront d’être enregistrées localement.",
        tone: "warning",
      })
    }
    previousOnline.current = isOnline
  }, [isOnline])

  useEffect(() => {
    if (lastOutcome && lastOutcome !== previousOutcome.current) {
      if (lastOutcome.conflicts > 0) {
        setMessage({
          title: `${lastOutcome.synced} synchronisée${lastOutcome.synced !== 1 ? "s" : ""}`,
          detail: `${lastOutcome.conflicts} vente${lastOutcome.conflicts > 1 ? "s" : ""} à vérifier.`,
          tone: "warning",
        })
      } else if (isOnline && wasOffline.current) {
        setMessage({
          title: lastOutcome.synced === 1
            ? "1 vente a été synchronisée"
            : `${lastOutcome.synced} ventes ont été synchronisées`,
          tone: "success",
        })
        wasOffline.current = false
      } else if (!isOnline && wasOffline.current) {
        return
      }
    }
    previousOutcome.current = lastOutcome
  }, [isOnline, lastOutcome])

  useEffect(() => {
    if (!message) return
    const timeoutId = window.setTimeout(() => setMessage(null), 5_000)
    return () => window.clearTimeout(timeoutId)
  }, [message])

  if (!message) return null

  return (
    <div className={`network-toast network-toast-${message.tone}`} role="status" aria-live="polite">
      <strong>{message.title}</strong>
      {message.detail ? <span>{message.detail}</span> : null}
    </div>
  )
}
