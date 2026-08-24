import { useState, type FormEvent } from "react"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { Link } from "react-router-dom"

import { listSales } from "../api/sales"
import { OperationalPageHeader } from "../components/layout/OperationalPageHeader"
import { EmptyState } from "../components/ui/EmptyState"
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
                      <span>{formatDateTime(sale.created_at)}</span>
                      <span>{sale.cash_register.name} · {sale.cashier.username}</span>
                    </div>
                    <div className="sale-row-payment">
                      <span>{paymentLabels[sale.payment.method]}</span>
                      {returned > 0 ? <span className="sale-return-status">Retour : − {formatBackendMoney(sale.returned_total!)}</span> : null}
                    </div>
                    <div className="sale-row-total">
                      <strong>{formatBackendMoney(sale.net_total ?? sale.total)}</strong>
                      {returned > 0 ? <span>Net</span> : <span>Total</span>}
                    </div>
                  </Link>
                )
              })}
            </section>
          ) : null}

          {salesQuery.data && (salesQuery.data.previous || salesQuery.data.next) ? (
            <nav className="sales-pagination" aria-label="Pagination des ventes">
              <button className="button button-secondary button-small" type="button" disabled={!salesQuery.data.previous} onClick={() => setPage((value) => Math.max(1, value - 1))}>Précédent</button>
              <span>Page {page}</span>
              <button className="button button-secondary button-small" type="button" disabled={!salesQuery.data.next} onClick={() => setPage((value) => value + 1)}>Suivant</button>
            </nav>
          ) : null}
        </>
      )}
    </main>
  )
}
