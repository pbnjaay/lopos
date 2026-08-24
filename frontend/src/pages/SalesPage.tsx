import { useState, type FormEvent } from "react"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { Link } from "react-router-dom"

import { listSales } from "../api/sales"
import { OperationalPageHeader } from "../components/layout/OperationalPageHeader"
import { EmptyState } from "../components/ui/EmptyState"
import { ChevronLeftIcon, ChevronRightIcon } from "../components/ui/Icons"
import { RouteState } from "../components/ui/RouteState"
import { useCurrentUser } from "../features/auth/queries"
import { usePosSession } from "../features/cash-session/queries"
import { useNetworkStatus } from "../features/offline/useNetworkStatus"
import type { PaymentMethod } from "../types/api"
import { formatDateTime } from "../utils/date"
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
  const [draft, setDraft] = useState<Filters>(emptyFilters)
  const [filters, setFilters] = useState<Filters>(emptyFilters)
  const [page, setPage] = useState(1)

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

  function submitFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPage(1)
    setFilters({ ...draft, search: draft.search.trim() })
  }

  const storeName = localSession?.storeName || "Boutique actuelle"
  const totalPages = salesQuery.data ? Math.ceil(salesQuery.data.count / SALES_PAGE_SIZE) : 0
  const paginationItems = getPaginationItems(page, totalPages)

  return (
    <main className="operational-page">
      <OperationalPageHeader
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
          description="Reconnectez-vous pour consulter les ventes et effectuer un retour."
        />
      ) : (
        <>
          <form className="sales-filters" onSubmit={submitFilters}>
            <div className="form-field sales-search-field">
              <label htmlFor="sales-search">Numéro du ticket</label>
              <input
                id="sales-search"
                value={draft.search}
                onChange={(event) => setDraft({ ...draft, search: event.target.value })}
                placeholder="Ex. A12F…"
              />
            </div>
            <div className="form-field">
              <label htmlFor="sales-date-from">Du</label>
              <input id="sales-date-from" type="date" value={draft.dateFrom} onChange={(event) => setDraft({ ...draft, dateFrom: event.target.value })} />
            </div>
            <div className="form-field">
              <label htmlFor="sales-date-to">Au</label>
              <input id="sales-date-to" type="date" value={draft.dateTo} onChange={(event) => setDraft({ ...draft, dateTo: event.target.value })} />
            </div>
            <div className="form-field">
              <label htmlFor="sales-payment">Paiement</label>
              <select id="sales-payment" value={draft.paymentMethod} onChange={(event) => setDraft({ ...draft, paymentMethod: event.target.value as PaymentMethod | "" })}>
                <option value="">Tous</option>
                <option value="CASH">Espèces</option>
                <option value="WAVE">Wave</option>
                <option value="ORANGE_MONEY">Orange Money</option>
              </select>
            </div>
            <button className="button button-primary" type="submit">Rechercher</button>
          </form>

          {salesQuery.isLoading ? <RouteState message="Chargement des ventes…" /> : null}
          {salesQuery.error ? <RouteState message="" error={salesQuery.error} onRetry={() => void salesQuery.refetch()} /> : null}
          {salesQuery.data?.results.length === 0 ? (
            <EmptyState
              title="Aucune vente trouvée"
              description="Modifiez les critères de recherche ou revenez au point de vente."
            />
          ) : null}
          {salesQuery.data?.results.length ? (
            <section className="sales-list" aria-label="Ventes de la boutique">
              {salesQuery.data.results.map((sale) => {
                const returned = Number(sale.returned_total ?? 0)
                return (
                  <Link className="sale-row" key={sale.id} to={`/sales/${sale.id}`}>
                    <div className="sale-row-main">
                      <strong>Ticket {sale.id.slice(0, 8).toUpperCase()}</strong>
                      <div className="sale-row-meta">
                        <span>{formatDateTime(sale.created_at)}</span>
                        <span aria-hidden="true">•</span>
                        <span>{sale.cash_register.name} · {sale.cashier.username}</span>
                      </div>
                    </div>
                    <div className="sale-row-summary">
                      <span className="payment-chip">{paymentLabels[sale.payment.method]}</span>
                      <strong>{formatBackendMoney(sale.net_total ?? sale.total)}</strong>
                      {returned > 0 ? <span>Net</span> : <span>Total</span>}
                      {returned > 0 ? <span className="sale-return-status">Retour : − {formatBackendMoney(sale.returned_total!)}</span> : null}
                    </div>
                  </Link>
                )
              })}
            </section>
          ) : null}

          {salesQuery.data && totalPages > 1 ? (
            <nav className="sales-pagination" aria-label="Pagination des ventes">
              <button
                className="sales-pagination-button sales-pagination-arrow"
                type="button"
                aria-label="Page précédente"
                disabled={page === 1}
                onClick={() => setPage((value) => Math.max(1, value - 1))}
              >
                <ChevronLeftIcon />
              </button>
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
              <button
                className="sales-pagination-button sales-pagination-arrow"
                type="button"
                aria-label="Page suivante"
                disabled={page === totalPages}
                onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
              >
                <ChevronRightIcon />
              </button>
            </nav>
          ) : null}
        </>
      )}
    </main>
  )
}
