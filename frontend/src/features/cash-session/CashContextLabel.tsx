import { useSessionStats } from "./SessionStatsLabel"

/**
 * Boutique et caisse dans l'en-tête global — l'identité du point de vente
 * est vraie toute la journée, elle appartient au chrome de l'application et
 * non au corps du POS, où elle prenait un titre de page entier.
 *
 * Même source que le menu de session : la session ouverte lue dans Dexie,
 * sans passer par la caisse mémorisée. Celle-ci peut manquer alors qu'une
 * session est bien ouverte — navigateur neuf, boutique à caisse unique :
 * l'app choisit la caisse d'elle-même et va au POS sans la mémoriser.
 * Lecture locale uniquement : l'affichage reste correct hors ligne.
 */
export function CashContextLabel() {
  const { session, duration } = useSessionStats()

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
