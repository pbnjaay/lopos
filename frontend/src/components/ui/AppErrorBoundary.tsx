import { useEffect } from "react"
import { useRouteError } from "react-router-dom"

import { Sentry } from "../../analytics/sentry"
import { Button } from "./Button"

/**
 * Repli des crashs inattendus. Sentry capture déjà la trace technique :
 * l'écran ne montre au caissier qu'un message actionnable et deux sorties.
 */
export function AppErrorFallback() {
  return (
    <main className="route-state">
      <div className="route-state-body route-state-error" role="alert">
        <strong>Un problème inattendu est survenu</strong>
        <p>
          L'écran n'a pas pu s'afficher correctement. Vos ventes enregistrées sur cette caisse
          sont conservées.
        </p>
        <div className="route-state-actions">
          <Button variant="primary" onClick={() => window.location.reload()}>
            Réessayer
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              window.location.href = "/pos"
            }}
          >
            Retour au point de vente
          </Button>
        </div>
      </div>
    </main>
  )
}

/**
 * errorElement du routeur. React Router intercepte en interne toute erreur de
 * rendu/loader levée sous lui et affiche par défaut son propre repli — un
 * message de debug ("💿 Hey developer") qui n'atteint jamais le
 * Sentry.ErrorBoundary posé autour de <RouterProvider> dans main.tsx, car
 * React Router ne laisse pas l'erreur remonter jusque-là. On capture donc
 * manuellement ici avant d'afficher le même repli que pour un crash au boot.
 */
export function RouterErrorBoundary() {
  const error = useRouteError()

  useEffect(() => {
    Sentry.captureException(error, { tags: { boundary: "router" } })
  }, [error])

  return <AppErrorFallback />
}
