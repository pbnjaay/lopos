import type { ReactNode } from "react"

type SectionHeaderProps = {
  eyebrow?: string
  title: string
  titleId?: string
  description?: ReactNode
  /** Compteur, statut ou action alignés à droite du titre. */
  trailing?: ReactNode
}

/** Titre de section — même rythme eyebrow → titre → description partout. */
export function SectionHeader({
  eyebrow,
  title,
  titleId,
  description,
  trailing,
}: SectionHeaderProps) {
  return (
    <div className="section-header">
      <div>
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h2 id={titleId}>{title}</h2>
        {description ? <p className="section-header-description">{description}</p> : null}
      </div>
      {trailing ? <div className="section-header-trailing">{trailing}</div> : null}
    </div>
  )
}
