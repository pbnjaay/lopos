import type { ReactNode } from "react"

export type BadgeTone = "neutral" | "success" | "warning" | "danger"

type BadgeProps = {
  tone?: BadgeTone
  icon?: ReactNode
  children: ReactNode
  className?: string
}

/** Étiquette d'état. Même hauteur, même rayon, même graisse partout —
 *  la couleur porte l'information, jamais la décoration. */
export function Badge({ tone = "neutral", icon, children, className = "" }: BadgeProps) {
  return (
    <span className={`badge badge-${tone} ${className}`.trim()}>
      {icon}
      {children}
    </span>
  )
}
