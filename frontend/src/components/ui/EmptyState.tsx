import type { ReactNode } from "react"

type EmptyStateProps = {
  title: string
  description?: string
  role?: "status"
  /** Action facultative — une seule, et seulement si elle débloque vraiment. */
  action?: ReactNode
  /** Variante encore plus dense, pour un état vide à l'intérieur d'une carte. */
  compact?: boolean
}

/**
 * État vide d'une application opérationnelle : compact, informatif, sans
 * grande illustration ni grand titre. Le caissier doit voir le reste de
 * l'écran, pas une page d'accueil.
 */
export function EmptyState({ title, description, role, action, compact = false }: EmptyStateProps) {
  return (
    <section className={compact ? "empty-state empty-state-compact" : "empty-state"} role={role}>
      <strong>{title}</strong>
      {description ? <p>{description}</p> : null}
      {action ? <div className="empty-state-action">{action}</div> : null}
    </section>
  )
}
