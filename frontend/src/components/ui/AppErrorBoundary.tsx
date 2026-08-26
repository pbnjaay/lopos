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
