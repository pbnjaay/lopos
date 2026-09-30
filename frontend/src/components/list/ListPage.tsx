import type { KeyboardEvent, ReactNode } from "react"

import { IconButton } from "../ui/IconButton"
import { ChevronLeftIcon, ChevronRightIcon } from "../ui/Icons"
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

type PaginationItem = number | "ellipsis-start" | "ellipsis-end"

function getPaginationItems(currentPage: number, totalPages: number): PaginationItem[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1)
  }

  if (currentPage <= 4) {
    return [1, 2, 3, 4, 5, "ellipsis-end", totalPages]
  }

  if (currentPage >= totalPages - 3) {
    return [1, "ellipsis-start", totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages]
  }

  return [1, "ellipsis-start", currentPage - 1, currentPage, currentPage + 1, "ellipsis-end", totalPages]
}

type ListPaginationProps = {
  /** Nom accessible (« Pagination des ventes »). */
  label: string
  page: number
  totalPages: number
  onChange: (page: number) => void
}

/** Pages d'une liste paginée côté serveur ; rien sous deux pages. */
export function ListPagination({ label, page, totalPages, onChange }: ListPaginationProps) {
  if (totalPages <= 1) return null
  return (
    <nav className="list-pagination" aria-label={label}>
      <IconButton
        label="Page précédente"
        icon={<ChevronLeftIcon />}
        surface
        disabled={page === 1}
        onClick={() => onChange(Math.max(1, page - 1))}
      />
      <div className="list-pagination-pages">
        {getPaginationItems(page, totalPages).map((item) => typeof item === "number" ? (
          <button
            key={item}
            className={`list-pagination-button${item === page ? " list-pagination-button-active" : ""}`}
            type="button"
            aria-label={`Page ${item}`}
            aria-current={item === page ? "page" : undefined}
            onClick={() => onChange(item)}
          >
            {item}
          </button>
        ) : (
          <span className="list-pagination-ellipsis" aria-hidden="true" key={item}>…</span>
        ))}
      </div>
      <IconButton
        label="Page suivante"
        icon={<ChevronRightIcon />}
        surface
        disabled={page === totalPages}
        onClick={() => onChange(Math.min(totalPages, page + 1))}
      />
    </nav>
  )
}
