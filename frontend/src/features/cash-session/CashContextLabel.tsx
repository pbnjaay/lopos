import { useQuery } from "@tanstack/react-query"

import { getLocalCashSessionForRegister } from "../../db/sessions"
import { useSessionStats } from "./SessionStatsLabel"
import { getStoredCashRegisterId } from "./storage"

/**
 * Boutique et caisse dans l'en-tête global — l'identité du point de vente
 * est vraie toute la journée, elle appartient au chrome de l'application et
 * non au corps du POS, où elle prenait un titre de page entier.
 *
 * Lecture Dexie uniquement, sur la clé de requête déjà utilisée par
 * `usePosSession` : aucun appel réseau supplémentaire, et l'affichage reste
 * correct hors ligne.
 */
export function CashContextLabel() {
  const cashRegisterId = getStoredCashRegisterId()
  const sessionQuery = useQuery({
    queryKey: ["local-cash-session", cashRegisterId],
    queryFn: () => getLocalCashSessionForRegister(cashRegisterId!),
    enabled: cashRegisterId !== null,
    staleTime: Infinity,
  })

  const { duration } = useSessionStats()

  const session = sessionQuery.data
  if (!session) return null
  if (!session.storeName && !session.cashRegisterName) return null

  const label = [session.storeName, session.cashRegisterName, duration && `ouverte depuis ${duration}`]
    .filter(Boolean)
    .join(" · ")

  // Une seule ligne, sans séparateur vertical : la boutique porte le poids,
  // la caisse et la durée suivent en gris.
  return (
    <p className="app-header-context" title={label}>
      {session.storeName ? <strong>{session.storeName}</strong> : null}
      {session.cashRegisterName ? (
        <span>
          {session.storeName ? " · " : ""}
          {session.cashRegisterName}
        </span>
      ) : null}
      {duration ? <span className="app-header-context-duration"> · ouverte depuis {duration}</span> : null}
    </p>
  )
}
