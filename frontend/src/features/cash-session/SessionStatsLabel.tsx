import { useEffect, useState } from "react"
import { useQuery } from "@tanstack/react-query"

import { getCashSessionSummary } from "../../api/cashSessions"
import { Money } from "../../components/ui/Money"
import { getOpenLocalCashSession } from "../../db/sessions"
import { useNetworkStatus } from "../offline/useNetworkStatus"

/**
 * « 47 min », « 4 h 12 », « 7 j 21 h » — la duree d'ouverture, pas une heure
 * d'horloge. Au-dela d'une journee on passe en jours : une caisse ouverte
 * depuis 189 heures est une anomalie a lire d'un coup d'oeil, pas un nombre
 * a dechiffrer.
 */
export function formatSessionDuration(openedAt: string, now: number): string | null {
  const openedTime = new Date(openedAt).getTime()
  if (Number.isNaN(openedTime)) return null
  const minutes = Math.floor((now - openedTime) / 60_000)
  if (minutes < 0) return null
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h ${String(minutes % 60).padStart(2, "0")}`
  return `${Math.floor(hours / 24)} j ${hours % 24} h`
}

/**
 * Etat de la session dans le chrome global : depuis combien de temps la
 * caisse est ouverte, et ce qu'elle a encaisse.
 *
 * Deux niveaux, volontairement :
 * la duree vient de Dexie et reste donc juste hors ligne ; le nombre de
 * ventes et le chiffre d'affaires viennent du serveur, parce que les ventes
 * locales ne couvrent que cet appareil — les compter ici afficherait « 0 »
 * sur un poste qui rejoint une session deja entamee. Quand le serveur n'est
 * pas joignable, ces deux chiffres disparaissent au lieu de mentir.
 */
export function SessionStatsLabel() {
  const isOnline = useNetworkStatus()
  // Pas de dependance a la caisse memorisee : elle peut etre absente alors
  // qu'une session est ouverte (voir getOpenLocalCashSession).
  // Pas de staleTime : la session est ecrite dans Dexie par le POS *apres*
  // que l'en-tete a deja interroge la base au montage. Un resultat vide mis
  // en cache resterait donc affiche indefiniment, l'en-tete muet alors qu'une
  // session est ouverte. Une lecture IndexedDB locale est negligeable.
  const sessionQuery = useQuery({
    queryKey: ["open-local-cash-session"],
    queryFn: () => getOpenLocalCashSession(),
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
  })
  const session = sessionQuery.data ?? null
  const sessionId = session?.id ?? null

  const summaryQuery = useQuery({
    queryKey: ["cash-sessions", sessionId, "summary"],
    queryFn: () => getCashSessionSummary(sessionId!),
    enabled: sessionId !== null && isOnline,
    staleTime: 60_000,
    retry: false,
  })

  // La duree doit avancer sans rechargement, mais une caisse reste ouverte
  // des heures : une minute de granularite suffit largement.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (sessionId === null) return
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [sessionId])

  if (!session) return null

  const duration = formatSessionDuration(session.openedAt, now)
  const summary = summaryQuery.data ?? null
  if (duration === null && summary === null) return null

  return (
    <>
      <span className="app-header-divider" aria-hidden="true" />
      <dl className="app-header-stats">
        {duration !== null ? (
          <div>
            <dt>Session</dt>
            <dd>{duration}</dd>
          </div>
        ) : null}
        {summary !== null ? (
          <>
            <div>
              <dt>Ventes</dt>
              <dd>{summary.sales_count}</dd>
            </div>
            <div>
              <dt>Encaissé</dt>
              <dd><Money backend={summary.gross_sales} /></dd>
            </div>
          </>
        ) : null}
      </dl>
    </>
  )
}
