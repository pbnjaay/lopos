import { useQuery } from "@tanstack/react-query"

import { getLocalCashSessionForRegister } from "../../db/sessions"
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

  const session = sessionQuery.data
  if (!session) return null

  const parts = [session.storeName, session.cashRegisterName].filter(Boolean)
  if (parts.length === 0) return null

  return (
    <>
      <span className="app-header-divider" aria-hidden="true" />
      <p className="app-header-context" title={parts.join(" · ")}>
        {parts.join(" · ")}
      </p>
    </>
  )
}
