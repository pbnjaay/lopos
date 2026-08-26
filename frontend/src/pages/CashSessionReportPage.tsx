import { useEffect } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useParams } from "react-router-dom"

import { getCashRegister } from "../api/cashRegisters"
import { getCashSessionSummary } from "../api/cashSessions"
import { getStore } from "../api/stores"
import { PageHeader } from "../components/layout/PageHeader"
import { Button } from "../components/ui/Button"
import { Money } from "../components/ui/Money"
import { RouteError, RouteLoading } from "../components/ui/RouteState"
import { formatDateTime } from "../utils/date"
import { describeCashDifference } from "../utils/money"

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

  if (!sessionId) return <RouteError context="rapport" title="Rapport introuvable" description="Cette session de caisse n’existe pas ou n’est plus accessible." />
  if (summaryQuery.isLoading || registerQuery.isLoading || storeQuery.isLoading) {
    return <RouteLoading message="Chargement du rapport Z…" />
  }
  const error = summaryQuery.error ?? registerQuery.error ?? storeQuery.error
  if (error) {
    return (
      <RouteError
        error={error}
        context="rapport"
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
  if (!summary || !store) return <RouteLoading message="Chargement du rapport Z…" />
  const difference = describeCashDifference(summary.cash_difference ?? "0.00")

  return (
    <main className="operational-page operational-page-narrow report-page">
      <div className="no-print">
        <PageHeader
          backTo="/cash/open"
          backLabel="Retour à l’ouverture de caisse"
          eyebrow="Fin de journée"
          title="Rapport Z"
          context={`${store.name} · ${summary.cash_register.name}`}
          actions={(
            <Button variant="primary" size="sm" onClick={() => window.print()}>
              Imprimer le rapport
            </Button>
          )}
        />
      </div>

      <article className="z-report" aria-label="Contenu du rapport Z">
        <header className="report-print-heading print-only" aria-hidden="true">
          <h1>Rapport Z</h1>
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
            <dt>Ventes brutes</dt>
            <dd><Money backend={summary.gross_sales} /></dd>
          </div>
          {summary.returns_total !== undefined ? <div>
            <dt>Retours</dt>
            <dd><Money backend={summary.returns_total ?? "0.00"} sign="minus" /></dd>
          </div> : null}
          {summary.net_sales !== undefined ? <div className="closing-summary-total">
            <dt>CA net</dt>
            <dd><Money backend={summary.net_sales ?? summary.gross_sales} /></dd>
          </div> : null}
          <div>
            <dt>Espèces</dt>
            <dd><Money backend={summary.payments.cash} /></dd>
          </div>
          <div>
            <dt>Wave</dt>
            <dd><Money backend={summary.payments.wave} /></dd>
          </div>
          <div>
            <dt>Orange Money</dt>
            <dd><Money backend={summary.payments.orange_money} /></dd>
          </div>
          {summary.refunds ? <><div><dt>Remboursements espèces</dt><dd><Money backend={summary.refunds.cash} sign="minus" /></dd></div>
          <div><dt>Remboursements Wave</dt><dd><Money backend={summary.refunds.wave} sign="minus" /></dd></div>
          <div><dt>Remboursements Orange Money</dt><dd><Money backend={summary.refunds.orange_money} sign="minus" /></dd></div></> : null}
          <div className="closing-summary-opening">
            <dt>Fond initial</dt>
            <dd><Money backend={summary.opening_balance} /></dd>
          </div>
          <div>
            <dt>Cash attendu</dt>
            <dd><Money backend={summary.expected_cash} /></dd>
          </div>
          <div>
            <dt>Cash compté</dt>
            <dd>
              {summary.counted_cash === null
                ? "Non compté"
                : <Money backend={summary.counted_cash} />}
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
