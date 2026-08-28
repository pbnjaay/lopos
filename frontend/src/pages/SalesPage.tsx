import { useEffect, useState, type KeyboardEvent } from "react"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { useNavigate } from "react-router-dom"

import { listSales } from "../api/sales"
import { PageHeader } from "../components/layout/PageHeader"
import { Badge } from "../components/ui/Badge"
import { EmptyState } from "../components/ui/EmptyState"
import { ErrorState } from "../components/ui/ErrorState"
import { IconButton } from "../components/ui/IconButton"
import { ChevronLeftIcon, ChevronRightIcon } from "../components/ui/Icons"
import { ListRow } from "../components/ui/ListRow"
import { Money } from "../components/ui/Money"
import { SkeletonRows } from "../components/ui/Skeleton"
import { useCurrentUser } from "../features/auth/queries"
import { usePosSession } from "../features/cash-session/queries"
import { useNetworkStatus } from "../features/offline/useNetworkStatus"
import { useDebouncedValue } from "../hooks/useDebouncedValue"
import type { PaymentMethod } from "../types/api"
import { formatDate, formatTime } from "../utils/date"
import { formatBackendMoney } from "../utils/money"

const paymentLabels: Record<PaymentMethod, string> = {
  CASH: "Espèces",
  WAVE: "Wave",
  ORANGE_MONEY: "Orange Money",
}

type Filters = {
  search: string
  dateFrom: string
  dateTo: string
  paymentMethod: PaymentMethod | ""
}

const emptyFilters: Filters = { search: "", dateFrom: "", dateTo: "", paymentMethod: "" }
const SALES_PAGE_SIZE = 20

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

export function SalesPage() {
  const user = useCurrentUser().data!
  const { ownSession, selectedRegister, localSession } = usePosSession(user)
  const online = useNetworkStatus()
  const navigate = useNavigate()
  const [draft, setDraft] = useState<Filters>(emptyFilters)
  const [page, setPage] = useState(1)
  const [highlightedIndex, setHighlightedIndex] = useState(0)

  // Recherche instantanée, comme le catalogue du POS : le même verbe ne peut
  // pas demander un clic ici et rien là-bas.
  const debouncedSearch = useDebouncedValue(draft.search.trim(), 250)
  const filters: Filters = { ...draft, search: debouncedSearch }
  const hasFilters = Boolean(
    debouncedSearch || draft.dateFrom || draft.dateTo || draft.paymentMethod,
  )

  // La page repart à 1 dans le gestionnaire, pas dans un effet : sinon la
  // requête part une première fois avec le nouveau filtre et l'ancienne page
  // (une page 5 qui n'existe peut-être plus), avant d'être corrigée.
  function updateFilter(patch: Partial<Filters>) {
    setDraft((current) => ({ ...current, ...patch }))
    setPage(1)
  }

  const salesQuery = useQuery({
    queryKey: ["sales", ownSession?.id, filters, page],
    queryFn: () => listSales({
      cashSessionId: ownSession!.id,
      search: filters.search,
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
      paymentMethod: filters.paymentMethod,
      page,
      pageSize: SALES_PAGE_SIZE,
    }),
    enabled: Boolean(ownSession && online),
    placeholderData: keepPreviousData,
    retry: false,
  })

  const storeName = localSession?.storeName || "Boutique actuelle"
  const count = salesQuery.data?.count ?? 0
  const totalPages = salesQuery.data ? Math.ceil(count / SALES_PAGE_SIZE) : 0
  const paginationItems = getPaginationItems(page, totalPages)
  const sales = salesQuery.data?.results ?? []
  // Une liste déjà affichée ne disparaît pas pendant qu'une nouvelle page
  // arrive : elle se marque simplement comme en cours de rafraîchissement.
  const isRefreshing = salesQuery.isFetching && !salesQuery.isLoading
  const pageTotal = sales.reduce(
    (sum, sale) => sum + Number(sale.net_total ?? sale.total),
    0,
  )
  const today = formatDate(new Date().toISOString())

  // Les lignes affichées sont celles de la recherche précédente tant que le
  // debounce court et que la requête n'a pas répondu (keepPreviousData).
  // Ouvrir la ligne visée à cet instant ouvrirait une vente que le caissier
  // n'a plus demandée — et un retour sur le mauvais ticket.
  const areResultsStale = draft.search.trim() !== debouncedSearch || salesQuery.isFetching
  const aimedSale = sales[highlightedIndex] ?? null

  useEffect(() => {
    setHighlightedIndex(0)
  }, [salesQuery.data])

  // Mêmes touches que le catalogue : flèches pour viser, Entrée pour ouvrir.
  // Le caissier garde la main sur le champ de recherche du début à la fin.
  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (sales.length === 0) return

    if (event.key === "ArrowDown") {
      event.preventDefault()
      setHighlightedIndex((index) => Math.min(index + 1, sales.length - 1))
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      setHighlightedIndex((index) => Math.max(index - 1, 0))
    } else if (event.key === "Enter") {
      event.preventDefault()
      if (areResultsStale || !aimedSale) return
      navigate(`/sales/${aimedSale.id}`)
    }
  }

  return (
    <main className="operational-page">
      <PageHeader
        backTo="/pos"
        backLabel="Retour au point de vente"
        eyebrow="Historique"
        title="Ventes"
        context={`${storeName} · ${selectedRegister?.name ?? "Caisse"}`}
      />

      {!online ? (
        <EmptyState
          role="status"
          title="Historique indisponible hors connexion"
          description="Vous pouvez continuer à vendre. L'historique redeviendra consultable dès le retour de la connexion."
        />
      ) : (
        <>
          <form className="sales-filters" role="search" onSubmit={(event) => event.preventDefault()}>
            <div className="field sales-search-field">
              <label htmlFor="sales-search">Numéro du ticket</label>
              <input
                id="sales-search"
                autoFocus
                autoComplete="off"
                value={draft.search}
                onChange={(event) => updateFilter({ search: event.target.value })}
                onKeyDown={handleSearchKeyDown}
                placeholder="Ex. A12F…"
              />
            </div>
            <div className="field">
              <label htmlFor="sales-date-from">Du</label>
              <input id="sales-date-from" type="date" value={draft.dateFrom} onChange={(event) => updateFilter({ dateFrom: event.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="sales-date-to">Au</label>
              <input id="sales-date-to" type="date" value={draft.dateTo} onChange={(event) => updateFilter({ dateTo: event.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="sales-payment">Paiement</label>
              <select id="sales-payment" value={draft.paymentMethod} onChange={(event) => updateFilter({ paymentMethod: event.target.value as PaymentMethod | "" })}>
                <option value="">Tous</option>
                <option value="CASH">Espèces</option>
                <option value="WAVE">Wave</option>
                <option value="ORANGE_MONEY">Orange Money</option>
              </select>
            </div>
          </form>

          <p className="search-hint">
            {areResultsStale
              ? "Recherche en cours…"
              : "Flèches pour parcourir les ventes, Entrée pour ouvrir la vente visée."}
          </p>

          {/* Le focus reste dans le champ de recherche : sans cette annonce,
              le changement de ligne visée n'atteindrait aucun lecteur d'écran. */}
          <p className="visually-hidden" role="status">
            {aimedSale && !areResultsStale
              ? `Vente visée : ticket ${aimedSale.id.slice(0, 8).toUpperCase()}, ${paymentLabels[aimedSale.payment.method]}, ${formatBackendMoney(aimedSale.net_total ?? aimedSale.total)}`
              : ""}
          </p>

          {/* La structure de la page reste en place pendant le chargement :
              les filtres ne disparaissent jamais sous le caissier. */}
          {salesQuery.isLoading ? (
            <SkeletonRows count={6} label="Chargement des ventes…" />
          ) : null}

          {salesQuery.error ? (
            <ErrorState
              error={salesQuery.error}
              context="historique"
              title="Impossible de charger les ventes"
              onRetry={() => void salesQuery.refetch()}
            />
          ) : null}

          {!salesQuery.isLoading && !salesQuery.error && sales.length === 0 ? (
            <EmptyState
              title="Aucune vente trouvée"
              description="Modifiez les critères de recherche ou revenez au point de vente."
            />
          ) : null}

          {sales.length > 0 ? (
            <>
              {/* Le total est celui de la page affichée : la liste paginée ne
                  connaît pas la somme de l'ensemble, et l'inventer serait pire
                  que de ne rien montrer. Le libellé le dit. */}
              <div className="sales-summary" role="status" aria-label="Résultat de la recherche">
                <span>
                  <strong>{count}</strong> vente{count > 1 ? "s" : ""}
                  {hasFilters ? ` trouvée${count > 1 ? "s" : ""}` : ""}
                </span>
                <span className="sales-summary-total">
                  <span>{totalPages > 1 ? "Total de la page" : "Total"}</span>
                  <strong>
                    <Money value={pageTotal} />
                  </strong>
                </span>
              </div>

              <section
                className={isRefreshing ? "sales-list sales-list-refreshing" : "sales-list"}
                aria-label="Ventes de la boutique"
                aria-busy={isRefreshing || undefined}
              >
                {sales.map((sale, index) => {
                  const returned = Number(sale.returned_total ?? 0)
                  const isFullyReturned = returned > 0 && returned >= Number(sale.total)
                  const day = formatDate(sale.created_at)
                  return (
                    <ListRow
                      key={sale.id}
                      to={`/sales/${sale.id}`}
                      highlighted={index === highlightedIndex}
                      onMouseEnter={() => setHighlightedIndex(index)}
                      leading={formatTime(sale.created_at)}
                      title={`Ticket ${sale.id.slice(0, 8).toUpperCase()}`}
                      meta={
                        <>
                          <span>{paymentLabels[sale.payment.method]}</span>
                          {/* La caisse est déjà dans l'en-tête, et la date ne
                              distingue rien tant que la liste tient sur le jour
                              courant : elle n'apparaît que si elle informe. */}
                          {day !== today ? (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>{day}</span>
                            </>
                          ) : null}
                        </>
                      }
                      trailing={
                        <span className="sales-row-financials">
                          <span className="sales-row-financial-primary">
                            {returned > 0 ? (
                              <Badge tone="warning">
                                {isFullyReturned ? "Retour total" : "Retour partiel"}
                              </Badge>
                            ) : null}
                            <Money backend={sale.net_total ?? sale.total} />
                          </span>
                          {returned > 0 ? (
                            <span className="sales-row-refunded">
                              −{formatBackendMoney(sale.returned_total!)} remboursés
                            </span>
                          ) : null}
                        </span>
                      }
                    />
                  )
                })}
              </section>
            </>
          ) : null}

          {salesQuery.data && totalPages > 1 ? (
            <nav className="sales-pagination" aria-label="Pagination des ventes">
              <IconButton
                label="Page précédente"
                icon={<ChevronLeftIcon />}
                surface
                disabled={page === 1}
                onClick={() => setPage((value) => Math.max(1, value - 1))}
              />
              <div className="sales-pagination-pages">
                {paginationItems.map((item) => typeof item === "number" ? (
                  <button
                    key={item}
                    className={`sales-pagination-button${item === page ? " sales-pagination-button-active" : ""}`}
                    type="button"
                    aria-label={`Page ${item}`}
                    aria-current={item === page ? "page" : undefined}
                    onClick={() => setPage(item)}
                  >
                    {item}
                  </button>
                ) : (
                  <span className="sales-pagination-ellipsis" aria-hidden="true" key={item}>…</span>
                ))}
              </div>
              <IconButton
                label="Page suivante"
                icon={<ChevronRightIcon />}
                surface
                disabled={page === totalPages}
                onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
              />
            </nav>
          ) : null}
        </>
      )}
    </main>
  )
}
