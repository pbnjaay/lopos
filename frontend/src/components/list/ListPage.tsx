import type { KeyboardEvent, ReactNode } from "react"

import { Money } from "../ui/Money"

/**
 * Briques communes des pages de liste (ventes, clients). Toutes suivent le
 * même ordre, de haut en bas :
 *
 *     PageHeader
 *     [alerte hors ligne]
 *     ListFilters   — recherche + un filtre à choix
 *     ListHint      — aide clavier + annonce de la ligne visée
 *     états         — chargement / erreur / vide
 *     ListSummary   — ce qui est affiché : nombre et total
 *     liste         — ListRow
 *     [pagination]
 */

/** Barre de filtres : un champ de recherche, puis un filtre à choix exclusif. */
export function ListFilters({ children }: { children: ReactNode }) {
  return (
    <form className="list-filters" role="search" onSubmit={(event) => event.preventDefault()}>
      {children}
    </form>
  )
}

type ListSearchFieldProps = {
  id: string
  label: string
  placeholder: string
  value: string
  onChange: (value: string) => void
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void
}

/** Champ de recherche d'une liste : il a le focus à l'arrivée et le garde. */
export function ListSearchField({ id, label, placeholder, value, onChange, onKeyDown }: ListSearchFieldProps) {
  return (
    <div className="field list-search-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        autoFocus
        autoComplete="off"
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
      />
    </div>
  )
}

/** Filtre à choix exclusif, avec le même libellé visible qu'un champ. */
export function ListFilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="field list-filter-field">
      <span className="field-label" aria-hidden="true">
        {label}
      </span>
      {children}
    </div>
  )
}

type ListHintProps = {
  /** « les ventes », « les clients ». */
  itemsLabel: string
  /** « la vente », « la fiche du client ». */
  openLabel: string
  isStale: boolean
  /** Ligne visée, annoncée aux lecteurs d'écran : le focus reste dans la recherche. */
  announcement: string
}

export function ListHint({ itemsLabel, openLabel, isStale, announcement }: ListHintProps) {
  return (
    <>
      <p className="list-hint">
        {isStale
          ? "Recherche en cours…"
          : `Flèches pour parcourir ${itemsLabel}, Entrée pour ouvrir ${openLabel} visée.`}
      </p>
      <p className="visually-hidden" role="status">
        {isStale ? "" : announcement}
      </p>
    </>
  )
}

type ListSummaryProps = {
  /** Nom accessible de la zone (« Résultat de la recherche »). */
  label: string
  count: ReactNode
  totalLabel: string
  total: number
}

/** Ce que la liste affiche : combien, et pour quel montant. */
export function ListSummary({ label, count, totalLabel, total }: ListSummaryProps) {
  return (
    <div className="list-summary" role="status" aria-label={label}>
      <span>{count}</span>
      <span className="list-summary-total">
        <span>{totalLabel}</span>
        <strong>
          <Money value={total} />
        </strong>
      </span>
    </div>
  )
}
