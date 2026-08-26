import type { ReactNode } from "react"

export type MetaItem = {
  label: string
  value: ReactNode
}

type MetaListProps = {
  items: MetaItem[]
  label: string
  columns?: 2 | 3
}

/** Bandeau de métadonnées (caisse, caissier, date, paiement) — une seule
 *  présentation pour la vente, le retour et la clôture. */
export function MetaList({ items, label, columns = 3 }: MetaListProps) {
  return (
    <div className={`meta-list meta-list-${columns}`} aria-label={label}>
      {items.map((item) => (
        <div key={item.label}>
          <span>{item.label}</span>
          <strong>{item.value}</strong>
        </div>
      ))}
    </div>
  )
}

type MetadataProps = {
  children: ReactNode
  className?: string
}

/** Métadonnées en ligne, séparées par des points médians — secondaires mais
 *  lisibles, jamais en dessous de 0.8rem. */
export function Metadata({ children, className = "" }: MetadataProps) {
  return <p className={`metadata ${className}`.trim()}>{children}</p>
}
