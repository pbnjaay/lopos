import type { ReactNode } from "react"
import { Link } from "react-router-dom"

type ListRowProps = {
  /** Rend la ligne entière cliquable — jamais un petit lien « Voir ». */
  to?: string
  leading?: ReactNode
  title: ReactNode
  meta?: ReactNode
  trailing?: ReactNode
  footnote?: ReactNode
  tone?: "default" | "warning"
}

/**
 * Ligne de liste métier — ventes, ventes en attente, conflits. Densité
 * alignée sur `.cart-item` du POS : plusieurs lignes visibles sans scroll.
 */
export function ListRow({
  to,
  leading,
  title,
  meta,
  trailing,
  footnote,
  tone = "default",
}: ListRowProps) {
  const className = ["list-row", tone === "warning" ? "list-row-warning" : ""]
    .filter(Boolean)
    .join(" ")

  const content = (
    <>
      {leading ? <span className="list-row-leading">{leading}</span> : null}
      <span className="list-row-main">
        <strong>{title}</strong>
        {meta ? <span className="list-row-meta">{meta}</span> : null}
      </span>
      {trailing ? <span className="list-row-trailing">{trailing}</span> : null}
      {footnote ? <span className="list-row-footnote">{footnote}</span> : null}
    </>
  )

  if (to) {
    return (
      <Link className={className} to={to}>
        {content}
      </Link>
    )
  }

  return <div className={className}>{content}</div>
}
