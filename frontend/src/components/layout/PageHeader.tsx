import type { ReactNode } from "react"
import { Link } from "react-router-dom"

import { ArrowLeftIcon } from "../ui/Icons"

type PageHeaderProps = {
  backTo?: string
  backLabel?: string
  eyebrow: string
  title: string
  /** Métadonnées de la page : boutique, caisse, caissier. */
  context?: ReactNode
  actions?: ReactNode
}

/**
 * En-tête de page unique :
 *
 *     EYEBROW
 *     Titre
 *     Métadonnées                        [actions]
 *
 * Aucune page ne redéfinit son propre titrage.
 */
export function PageHeader({
  backTo,
  backLabel,
  eyebrow,
  title,
  context,
  actions,
}: PageHeaderProps) {
  return (
    <header className="page-header">
      {backTo && backLabel ? (
        <Link className="page-header-back" to={backTo}>
          <ArrowLeftIcon />
          <span>{backLabel}</span>
        </Link>
      ) : null}
      <div className="page-header-row">
        <div className="page-header-identity">
          <p className="eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          {context ? <p className="metadata page-header-context">{context}</p> : null}
        </div>
        {actions ? <div className="page-header-actions">{actions}</div> : null}
      </div>
    </header>
  )
}
