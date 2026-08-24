import type { ReactNode } from "react"
import { Link } from "react-router-dom"

import { ArrowLeftIcon } from "../ui/Icons"

type OperationalPageHeaderProps = {
  backTo: string
  backLabel: string
  eyebrow: string
  title: string
  context?: ReactNode
  actions?: ReactNode
}

export function OperationalPageHeader({
  backTo,
  backLabel,
  eyebrow,
  title,
  context,
  actions,
}: OperationalPageHeaderProps) {
  return (
    <header className="operational-header">
      <Link className="operational-back-link" to={backTo}>
        <ArrowLeftIcon />
        <span>{backLabel}</span>
      </Link>
      <div className="operational-heading-row">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          {context ? <p className="operational-context">{context}</p> : null}
        </div>
        {actions ? <div className="operational-actions">{actions}</div> : null}
      </div>
    </header>
  )
}
