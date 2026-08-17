import { useEffect } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, useParams } from "react-router-dom"

import { getCashRegister } from "../api/cashRegisters"
import { getCashSessionSummary } from "../api/cashSessions"
import { getStore } from "../api/stores"
import { RouteState } from "../components/ui/RouteState"
import { formatDateTime } from "../utils/date"
import { describeCashDifference, formatBackendMoney } from "../utils/money"

export function CashSessionReportPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const queryClient = useQueryClient()
  const summaryQuery = useQuery({
    queryKey: ["cash-sessions", sessionId, "summary"],
    queryFn: () => getCashSessionSummary(sessionId!),
    enabled: Boolean(sessionId),
    retry: false,
  })
  const registerQuery = useQuery({
    queryKey: ["cash-registers", summaryQuery.data?.cash_register.id],
    queryFn: () => getCashRegister(summaryQuery.data!.cash_register.id),
    enabled: Boolean(summaryQuery.data),
  })
  const storeQuery = useQuery({
    queryKey: ["stores", registerQuery.data?.store_id],
    queryFn: () => getStore(registerQuery.data!.store_id),
    enabled: Boolean(registerQuery.data),
  })

  useEffect(() => {
    const summary = summaryQuery.data
    if (summary?.status !== "CLOSED") return

    queryClient.setQueryData(
      ["cash-registers", summary.cash_register.id, "current-session"],
      null,
    )
  }, [queryClient, summaryQuery.data])

  if (!sessionId) return <RouteState message="Rapport de caisse introuvable." />
  if (summaryQuery.isLoading || registerQuery.isLoading || storeQuery.isLoading) {
    return <RouteState message="Chargement du rapport Z…" />
  }
  const error = summaryQuery.error ?? registerQuery.error ?? storeQuery.error
  if (error) {
    return (
      <RouteState
        message=""
        error={error}
        onRetry={() => {
          void summaryQuery.refetch()
          if (summaryQuery.data) void registerQuery.refetch()
          if (registerQuery.data) void storeQuery.refetch()
        }}
      />
    )
  }

  const summary = summaryQuery.data
  const store = storeQuery.data
  if (!summary || !store) return <RouteState message="Chargement du rapport Z…" />
  const difference = describeCashDifference(summary.cash_difference ?? "0.00")

  return (
    <main className="report-page">
      <article className="z-report" aria-labelledby="z-report-title">
        <header className="report-heading">
          <div>
            <p className="eyebrow">Fin de journée</p>
            <h1 id="z-report-title">Rapport Z</h1>
          </div>
          <div className="report-actions no-print">
            <Link className="text-button" to="/cash/open">
              Retour
            </Link>
            <button className="button button-primary button-small" type="button" onClick={() => window.print()}>
              Imprimer
            </button>
          </div>
        </header>

        <div className="report-identity">
          <strong>{store.name}</strong>
          <span>{summary.cash_register.name}</span>
          <span>Caissier : {summary.cashier.username}</span>
          <span>Ouverture : {formatDateTime(summary.opened_at)}</span>
          <span>
            Clôture : {summary.closed_at ? formatDateTime(summary.closed_at) : "Session ouverte"}
          </span>
        </div>

        <dl className="closing-summary report-totals">
          <div className="closing-summary-total">
            <dt>Nombre de ventes</dt>
            <dd>{summary.sales_count}</dd>
          </div>
          <div className="closing-summary-total">
            <dt>Chiffre d’affaires</dt>
            <dd>{formatBackendMoney(summary.gross_sales)}</dd>
          </div>
          <div>
            <dt>Espèces</dt>
            <dd>{formatBackendMoney(summary.payments.cash)}</dd>
          </div>
          <div>
            <dt>Wave</dt>
            <dd>{formatBackendMoney(summary.payments.wave)}</dd>
          </div>
          <div>
            <dt>Orange Money</dt>
            <dd>{formatBackendMoney(summary.payments.orange_money)}</dd>
          </div>
          <div className="closing-summary-opening">
            <dt>Fond initial</dt>
            <dd>{formatBackendMoney(summary.opening_balance)}</dd>
          </div>
          <div>
            <dt>Cash attendu</dt>
            <dd>{formatBackendMoney(summary.expected_cash)}</dd>
          </div>
          <div>
            <dt>Cash compté</dt>
            <dd>
              {summary.counted_cash === null
                ? "Non compté"
                : formatBackendMoney(summary.counted_cash)}
            </dd>
          </div>
          <div className={`cash-difference cash-difference-${difference.kind}`}>
            <dt>Écart</dt>
            <dd>{summary.cash_difference === null ? "Non disponible" : difference.label}</dd>
          </div>
        </dl>
      </article>
    </main>
  )
}
