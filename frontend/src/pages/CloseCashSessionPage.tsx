import { useQuery } from "@tanstack/react-query"
import { Link } from "react-router-dom"

import { getCashSessionSummary } from "../api/cashSessions"
import { RouteState } from "../components/ui/RouteState"
import { useCurrentUser } from "../features/auth/queries"
import { usePosSession } from "../features/cash-session/queries"
import { formatDateTime } from "../utils/date"
import { formatBackendMoney } from "../utils/money"

export function CloseCashSessionPage() {
  const user = useCurrentUser().data!
  const { ownSession } = usePosSession(user.id)
  const summaryQuery = useQuery({
    queryKey: ["cash-sessions", ownSession?.id, "summary"],
    queryFn: () => getCashSessionSummary(ownSession!.id),
    enabled: ownSession !== null,
  })

  if (!ownSession || summaryQuery.isLoading) {
    return <RouteState message="Chargement du résumé de caisse…" />
  }
  if (summaryQuery.error) {
    return (
      <RouteState
        message=""
        error={summaryQuery.error}
        onRetry={() => void summaryQuery.refetch()}
      />
    )
  }

  const summary = summaryQuery.data
  if (!summary) return <RouteState message="Chargement du résumé de caisse…" />

  return (
    <main className="closing-page">
      <section className="closing-sheet" aria-labelledby="close-session-title">
        <header className="closing-heading">
          <div>
            <p className="eyebrow">Fin de journée</p>
            <h1 id="close-session-title">Clôturer la caisse</h1>
          </div>
          <Link className="text-button close-session-back-link" to="/pos">
            Retour au point de vente
          </Link>
        </header>

        <div className="closing-identity">
          <strong>{summary.cash_register.name}</strong>
          <span>Caissier : {summary.cashier.username}</span>
          <span>Ouverte le {formatDateTime(summary.opened_at)}</span>
        </div>

        <dl className="closing-summary" aria-label="Résumé de la session">
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
        </dl>

        <p className="closing-instruction">
          Comptez maintenant l’argent présent dans le tiroir-caisse.
        </p>
      </section>
    </main>
  )
}
