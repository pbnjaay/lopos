import { useState } from "react"
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query"

import { listExpenseCategories, listExpenses } from "../api/expenses"
import { PageHeader } from "../components/layout/PageHeader"
import { ListFilterField, ListFilters, ListPagination, ListSummary } from "../components/list/ListPage"
import { Badge } from "../components/ui/Badge"
import { Button } from "../components/ui/Button"
import { EmptyState } from "../components/ui/EmptyState"
import { ErrorState } from "../components/ui/ErrorState"
import { PlusIcon } from "../components/ui/Icons"
import { InlineAlert } from "../components/ui/InlineAlert"
import { ListRow } from "../components/ui/ListRow"
import { Money } from "../components/ui/Money"
import { SegmentedControl } from "../components/ui/SegmentedControl"
import { SkeletonRows } from "../components/ui/Skeleton"
import { useToast } from "../components/ui/Toast"
import { useCurrentUser } from "../features/auth/queries"
import { usePosSession } from "../features/cash-session/queries"
import { NewExpenseDialog, expenseCategoriesQueryKey } from "../features/expenses/NewExpenseDialog"
import { useNetworkStatus } from "../features/offline/useNetworkStatus"
import { PAYMENT_LABELS } from "../features/sales/paymentLabels"
import type { Expense, PaymentMethod } from "../types/api"
import { formatDate, formatTime, localIsoDate } from "../utils/date"
import { formatBackendMoney } from "../utils/money"

type Period = "today" | "7d" | "30d"

type Filters = {
  period: Period
  paymentMethod: PaymentMethod | ""
  categoryId: string
}

const emptyFilters: Filters = { period: "today", paymentMethod: "", categoryId: "" }

const PERIOD_OPTIONS: ReadonlyArray<{ value: Period; label: string }> = [
  { value: "today", label: "Aujourd’hui" },
  { value: "7d", label: "7 jours" },
  { value: "30d", label: "30 jours" },
]

const PERIOD_DAYS: Record<Period, number> = { today: 0, "7d": 6, "30d": 29 }

const PAYMENT_FILTER_OPTIONS: ReadonlyArray<{ value: PaymentMethod | ""; label: string }> = [
  { value: "", label: "Tous" },
  { value: "CASH", label: "Espèces" },
  { value: "WAVE", label: "Wave" },
  { value: "ORANGE_MONEY", label: "Orange Money" },
]

const EXPENSES_PAGE_SIZE = 20

function ExpenseRow({ expense, today }: { expense: Expense; today: string }) {
  const cancelled = expense.status === "CANCELLED"
  const day = formatDate(expense.occurred_at)
  return (
    <ListRow
      to={`/expenses/${encodeURIComponent(expense.id)}`}
      leading={formatTime(expense.occurred_at)}
      title={expense.category.name}
      meta={
        <>
          {expense.description ? (
            <>
              <span>{expense.description}</span>
              <span aria-hidden="true">·</span>
            </>
          ) : null}
          <span>{PAYMENT_LABELS[expense.payment_method]}</span>
          <span aria-hidden="true">·</span>
          <span>{expense.created_by}</span>
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
          {cancelled ? <Badge tone="neutral">Annulée</Badge> : null}
          <span className={cancelled ? "expense-amount-cancelled" : undefined}>
            <Money backend={expense.amount} />
          </span>
        </span>
      }
    />
  )
}

/**
 * Dépenses de la boutique : l'argent sorti pour la faire tourner.
 * Une ligne ouvre la fiche, d'où l'on annule. Même
 * structure que les ventes et le cahier ; « Nouvelle dépense » est l'action
 * de la page, jamais un bouton sur l'écran de vente.
 */
export function ExpensesPage() {
  const user = useCurrentUser().data!
  const { ownSession, selectedRegister, localSession } = usePosSession(user)
  const online = useNetworkStatus()
  const queryClient = useQueryClient()
  const toast = useToast()
  const [filters, setFilters] = useState<Filters>(emptyFilters)
  const [page, setPage] = useState(1)
  const [isCreating, setIsCreating] = useState(false)

  function updateFilter(patch: Partial<Filters>) {
    setFilters((current) => ({ ...current, ...patch }))
    setPage(1)
  }

  const categoriesQuery = useQuery({
    queryKey: expenseCategoriesQueryKey,
    queryFn: listExpenseCategories,
    enabled: online,
    staleTime: 5 * 60_000,
    retry: false,
  })

  const expensesQuery = useQuery({
    queryKey: ["expenses", ownSession?.id, filters, page],
    queryFn: () =>
      listExpenses({
        cashSessionId: ownSession!.id,
        dateFrom: localIsoDate(PERIOD_DAYS[filters.period]),
        dateTo: localIsoDate(),
        categoryId: filters.categoryId,
        paymentMethod: filters.paymentMethod,
        page,
        pageSize: EXPENSES_PAGE_SIZE,
      }),
    enabled: Boolean(ownSession && online),
    placeholderData: keepPreviousData,
    retry: false,
  })

  const storeName = localSession?.storeName || "Boutique actuelle"
  const count = expensesQuery.data?.count ?? 0
  const totalPages = expensesQuery.data ? Math.ceil(count / EXPENSES_PAGE_SIZE) : 0
  const expenses = expensesQuery.data?.results ?? []
  const totals = expensesQuery.data?.totals
  const isRefreshing = expensesQuery.isFetching && !expensesQuery.isLoading
  const today = formatDate(new Date().toISOString())
  const cancelledCount = count - (totals?.count ?? count)

  return (
    <main className="operational-page">
      <PageHeader
        backTo="/pos"
        backLabel="Retour au point de vente"
        eyebrow="Historique"
        title="Dépenses"
        context={`${storeName} · ${selectedRegister?.name ?? "Caisse"}`}
        actions={
          online && ownSession ? (
            <Button variant="primary" size="sm" onClick={() => setIsCreating(true)}>
              <PlusIcon />
              <span>Nouvelle dépense</span>
            </Button>
          ) : null
        }
      />

      {!online ? (
        <InlineAlert title="Hors connexion">
          Les dépenses s’enregistrent et se consultent en ligne. Notez celles de maintenant et
          saisissez-les au retour de la connexion.
        </InlineAlert>
      ) : (
        <>
          <ListFilters>
            <ListFilterField label="Période">
              <SegmentedControl
                label="Période"
                options={PERIOD_OPTIONS}
                value={filters.period}
                onChange={(period) => updateFilter({ period })}
              />
            </ListFilterField>
            <ListFilterField label="Mode">
              <SegmentedControl
                label="Mode de paiement"
                options={PAYMENT_FILTER_OPTIONS}
                value={filters.paymentMethod}
                onChange={(paymentMethod) => updateFilter({ paymentMethod })}
              />
            </ListFilterField>
            <div className="field list-filter-field">
              <label htmlFor="expenses-category">Catégorie</label>
              <select
                id="expenses-category"
                value={filters.categoryId}
                onChange={(event) => updateFilter({ categoryId: event.target.value })}
              >
                <option value="">Toutes</option>
                {(categoriesQuery.data ?? []).map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </div>
          </ListFilters>

          {expensesQuery.isLoading ? <SkeletonRows count={5} label="Chargement des dépenses…" /> : null}

          {expensesQuery.error ? (
            <ErrorState
              error={expensesQuery.error}
              context="depense"
              title="Impossible de charger les dépenses"
              onRetry={() => void expensesQuery.refetch()}
            />
          ) : null}

          {!expensesQuery.isLoading && !expensesQuery.error && expenses.length === 0 ? (
            <EmptyState
              title="Aucune dépense sur cette période"
              description="Électricité, transport, réparation… saisissez chaque sortie d’argent avec « Nouvelle dépense »."
            />
          ) : null}

          {expenses.length > 0 && totals ? (
            <>
              {/* Le total vient du serveur et couvre tout le filtre, pas la
                  seule page affichée ; les dépenses annulées n'y comptent pas. */}
              <ListSummary
                label="Dépenses de la période"
                count={
                  <>
                    <strong>{totals.count}</strong> dépense{totals.count > 1 ? "s" : ""}
                    {cancelledCount > 0
                      ? ` · ${cancelledCount} annulée${cancelledCount > 1 ? "s" : ""}`
                      : ""}
                    {Number(totals.cash) > 0 ? ` · dont ${formatBackendMoney(totals.cash)} en espèces` : ""}
                  </>
                }
                totalLabel="Total"
                total={Math.round(Number(totals.total))}
              />

              <section
                className={isRefreshing ? "list-rows list-rows-refreshing" : "list-rows"}
                aria-label="Dépenses de la boutique"
                aria-busy={isRefreshing || undefined}
              >
                {expenses.map((expense) => (
                  <ExpenseRow key={expense.id} expense={expense} today={today} />
                ))}
              </section>
            </>
          ) : null}

          <ListPagination
            label="Pagination des dépenses"
            page={page}
            totalPages={totalPages}
            onChange={setPage}
          />
        </>
      )}

      {isCreating && ownSession ? (
        <NewExpenseDialog
          cashSessionId={ownSession.id}
          onClose={() => setIsCreating(false)}
          onRecorded={(expense) => {
            setIsCreating(false)
            toast.success("Dépense enregistrée", {
              description: `${formatBackendMoney(expense.amount)} · ${expense.category.name}`,
            })
            void queryClient.invalidateQueries({ queryKey: ["expenses"] })
            // Le cash attendu de la session a changé (menu de session, clôture).
            void queryClient.invalidateQueries({ queryKey: ["cash-sessions"] })
          }}
        />
      ) : null}
    </main>
  )
}
