import { Button } from "./Button"
import { describeError, type ErrorContext } from "../../utils/errorCopy"

type RouteLoadingProps = {
  /** Décrit ce qui charge — annoncé, jamais imprimé en gros au centre. */
  message: string
}

/**
 * Attente d'une route entière (résolution de session, redirection). La
 * structure de l'application n'est pas encore connue à ce stade : on garde
 * une surface neutre plutôt qu'un squelette mensonger.
 */
export function RouteLoading({ message }: RouteLoadingProps) {
  return (
    <main className="route-state" aria-busy="true">
      <div className="route-state-body" role="status" aria-live="polite">
        <span className="spinner spinner-lg" aria-hidden="true" />
        <p>{message}</p>
      </div>
    </main>
  )
}

type RouteErrorProps = {
  error?: unknown
  context?: ErrorContext
  title?: string
  description?: string
  onRetry?: () => void
}

/** Échec bloquant d'une route entière. */
export function RouteError({ error, context = "generique", title, description, onRetry }: RouteErrorProps) {
  const copy = describeError(error, context)

  return (
    <main className="route-state">
      <div className="route-state-body route-state-error" role="alert">
        <strong>{title ?? copy.title}</strong>
        <p>{description ?? copy.description}</p>
        {onRetry ? (
          <Button variant="primary" onClick={onRetry}>
            Réessayer
          </Button>
        ) : null}
      </div>
    </main>
  )
}
