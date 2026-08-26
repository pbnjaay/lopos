import type { ReactNode } from "react"

import { Button } from "./Button"
import { describeError, type ErrorContext } from "../../utils/errorCopy"

type ErrorStateProps = {
  error?: unknown
  context?: ErrorContext
  /** Remplace le titre déduit de l'erreur. */
  title?: string
  description?: string
  onRetry?: () => void
  retryLabel?: string
  /** Sortie de secours — retour au POS, retour à la liste… */
  secondaryAction?: ReactNode
}

/**
 * Erreur bloquante : l'utilisateur ne peut pas continuer sur cet écran.
 * Le message explique le problème, dit quoi faire, et porte le bouton de
 * reprise juste à côté.
 */
export function ErrorState({
  error,
  context = "generique",
  title,
  description,
  onRetry,
  retryLabel = "Réessayer",
  secondaryAction,
}: ErrorStateProps) {
  const copy = describeError(error, context)
  const showRetry = Boolean(onRetry) && (copy.canRetry || title !== undefined)

  return (
    <section className="error-state" role="alert">
      <strong>{title ?? copy.title}</strong>
      <p>{description ?? copy.description}</p>
      {showRetry || secondaryAction ? (
        <div className="error-state-actions">
          {showRetry ? (
            <Button variant="primary" size="sm" onClick={onRetry}>
              {retryLabel}
            </Button>
          ) : null}
          {secondaryAction}
        </div>
      ) : null}
    </section>
  )
}
