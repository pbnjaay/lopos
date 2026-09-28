import { useState } from "react"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { useNavigate } from "react-router-dom"

import { listSales } from "../api/sales"
import { PageHeader } from "../components/layout/PageHeader"
import {
  ListFilterField,
  ListFilters,
  ListHint,
  ListSearchField,
  ListSummary,
} from "../components/list/ListPage"
import { Badge } from "../components/ui/Badge"
import { EmptyState } from "../components/ui/EmptyState"
import { ErrorState } from "../components/ui/ErrorState"
import { IconButton } from "../components/ui/IconButton"
import { ChevronLeftIcon, ChevronRightIcon } from "../components/ui/Icons"
import { InlineAlert } from "../components/ui/InlineAlert"
import { ListRow } from "../components/ui/ListRow"
import { Money } from "../components/ui/Money"
import { SegmentedControl } from "../components/ui/SegmentedControl"
import { SkeletonRows } from "../components/ui/Skeleton"
import { listRecentLocalSales } from "../db/sales"
import type { LocalSale } from "../db/types"
import { useCurrentUser } from "../features/auth/queries"
import { usePosSession } from "../features/cash-session/queries"
import { useNetworkStatus } from "../features/offline/useNetworkStatus"
import { useDebouncedValue } from "../hooks/useDebouncedValue"
import { useListNavigation } from "../hooks/useListNavigation"
import type { PaymentMethod } from "../types/api"
import { formatDate, formatTime } from "../utils/date"
import { formatBackendMoney } from "../utils/money"
import { describeSettlement } from "../features/sales/paymentLabels"

// Pas de filtre de dates : la liste est déjà bornée à la session de caisse
// en cours, et des bornes « Du / Au » y filtraient une journée déjà filtrée.
type Filters = {
  search: string
  paymentMethod: PaymentMethod | ""
}

const emptyFilters: Filters = { search: "", paymentMethod: "" }

const PAYMENT_FILTER_OPTIONS: ReadonlyArray<{ value: PaymentMethod | ""; label: string }> = [
  { value: "", label: "Tous" },
  { value: "CASH", label: "Espèces" },
  { value: "WAVE", label: "Wave" },
  { value: "ORANGE_MONEY", label: "Orange Money" },
]
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

const localStatusBadges: Partial<Record<LocalSale["status"], { tone: "warning" | "neutral"; label: string }>> = {
  PENDING_SYNC: { tone: "neutral", label: "En attente d’envoi" },
  CONFLICT: { tone: "warning", label: "À vérifier" },
}

/**
 * Hors connexion, l'historique serveur est hors d'atteinte, mais les ventes
 * encaissées sur cet appareil sont dans Dexie : le caissier retrouve et
 * réimprime un ticket sans attendre le réseau. Seul le ticket est ouvert —
 * le détail et les retours passent par le serveur.
 */
function OfflineSalesList({ cashSessionId }: { cashSessionId: string }) {
  const localSalesQuery = useQuery({
    queryKey: ["local-sales-for-session", cashSessionId],
    queryFn: () => listRecentLocalSales(cashSessionId, Number.POSITIVE_INFINITY),
  })
  const sales = localSalesQuery.data ?? []
  const today = formatDate(new Date().toISOString())
  const total = sales.reduce((sum, sale) => sum + sale.total, 0)

  return (
    <>
      <InlineAlert title="Hors connexion : ventes de cet appareil">
        Seules les ventes encaissées sur cette caisse apparaissent, sans les retours
        ni les annulations faits ailleurs. Le détail et les retours reviennent avec
        la connexion.
      </InlineAlert>

      {localSalesQuery.isLoading ? (
        <SkeletonRows count={4} label="Chargement des ventes de cet appareil…" />
      ) : sales.length === 0 ? (
        <EmptyState
          role="status"
          title="Aucune vente sur cet appareil"
          description="Les ventes encaissées ici pendant cette session apparaîtront dans cette liste."
        />
      ) : (
        <>
          <ListSummary
            label="Ventes de cet appareil"
            count={
              <>
                <strong>{sales.length}</strong> vente{sales.length > 1 ? "s" : ""} sur cet appareil
              </>
            }
            totalLabel="Total"
            total={total}
          />
          <section className="list-rows" aria-label="Ventes de cet appareil">
            {sales.map((sale) => {
              const day = formatDate(sale.createdAt)
              const badge = localStatusBadges[sale.status]
              return (
                <ListRow
                  key={sale.id}
                  to={`/sales/${encodeURIComponent(sale.id)}/receipt`}
                  leading={formatTime(sale.createdAt)}
                  title={`Ticket ${sale.id.slice(0, 8).toUpperCase()}`}
                  meta={
                    <>
                      <span>
                        {describeSettlement(sale.payments, sale.creditAmount ?? 0)}
                      </span>
                      {day !== today ? (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>{day}</span>
                        </>
                      ) : null}
                    </>
                  }
                  trailing={
                    <span className="sales-row-financial-primary">
                      {badge ? <Badge tone={badge.tone}>{badge.label}</Badge> : null}
                      <Money value={sale.total} />
                    </span>
                  }
                />
              )
            })}
          </section>
        </>
      )}
    </>
  )
}

export function SalesPage() {
  const user = useCurrentUser().data!
  const { ownSession, selectedRegister, localSession } = usePosSession(user)
  const online = useNetworkStatus()
  const navigate = useNavigate()
  const [draft, setDraft] = useState<Filters>(emptyFilters)
  const [page, setPage] = useState(1)

  // Recherche instantanée, comme le catalogue du POS : le même verbe ne peut
  // pas demander un clic ici et rien là-bas.
  const debouncedSearch = useDebouncedValue(draft.search.trim(), 250)
  const filters: Filters = { ...draft, search: debouncedSearch }
  const hasFilters = Boolean(debouncedSearch || draft.paymentMethod)

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
  const { highlightedIndex, setHighlightedIndex, aimedItem: aimedSale, handleKeyDown } =
    useListNavigation(sales, {
      onOpen: (sale) => navigate(`/sales/${sale.id}`),
      isStale: areResultsStale,
      resetKey: salesQuery.data,
    })

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
        ownSession ? <OfflineSalesList cashSessionId={ownSession.id} /> : null
      ) : (
        <>
          <ListFilters>
            <ListSearchField
              id="sales-search"
              label="Numéro du ticket"
              placeholder="Ex. A12F…"
              value={draft.search}
              onChange={(search) => updateFilter({ search })}
              onKeyDown={handleKeyDown}
            />
            <ListFilterField label="Paiement">
              <SegmentedControl
                label="Paiement"
                options={PAYMENT_FILTER_OPTIONS}
                value={draft.paymentMethod}
                onChange={(paymentMethod) => updateFilter({ paymentMethod })}
              />
            </ListFilterField>
          </ListFilters>

          <ListHint
            itemsLabel="les ventes"
            openLabel="la vente"
            isStale={areResultsStale}
            announcement={
              aimedSale
                ? `Vente visée : ticket ${aimedSale.id.slice(0, 8).toUpperCase()}, ${describeSettlement(aimedSale.payments, Math.round(Number(aimedSale.credit_amount ?? 0)))}, ${formatBackendMoney(aimedSale.net_total ?? aimedSale.total)}`
                : ""
            }
          />

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
              <ListSummary
                label="Résultat de la recherche"
                count={
                  <>
                    <strong>{count}</strong> vente{count > 1 ? "s" : ""}
                    {hasFilters ? ` trouvée${count > 1 ? "s" : ""}` : ""}
                  </>
                }
                totalLabel={totalPages > 1 ? "Total de la page" : "Total"}
                total={pageTotal}
              />

              <section
                className={isRefreshing ? "list-rows list-rows-refreshing" : "list-rows"}
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
                          <span>
                            {describeSettlement(sale.payments, Math.round(Number(sale.credit_amount ?? 0)))}
                          </span>
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
            <nav className="list-pagination" aria-label="Pagination des ventes">
              <IconButton
                label="Page précédente"
                icon={<ChevronLeftIcon />}
                surface
                disabled={page === 1}
                onClick={() => setPage((value) => Math.max(1, value - 1))}
              />
              <div className="list-pagination-pages">
                {paginationItems.map((item) => typeof item === "number" ? (
                  <button
                    key={item}
                    className={`list-pagination-button${item === page ? " list-pagination-button-active" : ""}`}
                    type="button"
                    aria-label={`Page ${item}`}
                    aria-current={item === page ? "page" : undefined}
                    onClick={() => setPage(item)}
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
                onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
              />
            </nav>
          ) : null}
        </>
      )}
    </main>
  )
}
