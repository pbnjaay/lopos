import type { ReactNode } from "react"

export type AlertTone = "info" | "success" | "warning" | "error"

type InlineAlertProps = {
  tone?: AlertTone
  title?: ReactNode
  children?: ReactNode
  /** Action de récupération — placée dans le message, jamais ailleurs. */
  action?: ReactNode
  /**
   * Annonce le message comme une alerte même sans ton `error`. Réservé aux
   * situations réellement bloquantes qui n'appellent pas le rouge : le
   * catalogue hors ligne empêche de vendre sans être une panne.
   */
  assertive?: boolean
  className?: string
}

const roleByTone: Record<AlertTone, "alert" | "status"> = {
  info: "status",
  success: "status",
  warning: "status",
  error: "alert",
}

/**
 * Message contextuel attaché à une zone de l'écran. Remplace tous les
 * `<p className="form-error">` isolés : un seul rendu, un rôle ARIA correct,
 * et l'action de reprise au même endroit que le message.
 */
export function InlineAlert({
  tone = "info",
  title,
  children,
  action,
  assertive = false,
  className = "",
}: InlineAlertProps) {
  return (
    <div
      className={`inline-alert inline-alert-${tone} ${className}`.trim()}
      role={assertive ? "alert" : roleByTone[tone]}
    >
      <div className="inline-alert-copy">
        {title ? <strong>{title}</strong> : null}
        {children ? <span>{children}</span> : null}
      </div>
      {action ? <div className="inline-alert-action">{action}</div> : null}
    </div>
  )
}
