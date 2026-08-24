import { Link } from "react-router-dom"

import { OperationalPageHeader } from "../../components/layout/OperationalPageHeader"
import type { CashSessionSummary } from "../../types/api"
import { formatDateTime } from "../../utils/date"
import { describeCashDifference, formatBackendMoney } from "../../utils/money"

type CashClosingResultProps = {
  summary: CashSessionSummary
  onFinish: () => void
}

export function CashClosingResult({ summary, onFinish }: CashClosingResultProps) {
  const difference = describeCashDifference(summary.cash_difference ?? "0.00")

  return (
    <main className="operational-page operational-page-narrow closing-result-page">
      <OperationalPageHeader
        eyebrow="Fin de journée"
        title="Caisse clôturée"
        context={summary.cash_register.name}
      />
      <section className="operational-card closing-sheet closing-result-state" aria-live="polite">
        <div className="closing-result-intro">
          <div className="success-mark" aria-hidden="true">✓</div>
          <div>
            <h2>Session terminée</h2>
            <p className="muted">Les ventes et les montants de cette caisse ont été enregistrés.</p>
          </div>
        </div>
        <div className="closing-session-meta">
          <div><span>Caissier</span><strong>{summary.cashier.username}</strong></div>
          {summary.closed_at ? <div><span>Clôture</span><strong>{formatDateTime(summary.closed_at)}</strong></div> : null}
        </div>

        <div className="closing-section-heading">
          <div><p className="eyebrow">Résultat</p><h2>Résumé de clôture</h2></div>
        </div>
        <dl className="closing-summary closing-result-summary" aria-label="Résultat de clôture">
          <div className="closing-summary-kpi">
            <dt>Nombre de ventes</dt>
            <dd>{summary.sales_count}</dd>
          </div>
          <div className="closing-summary-kpi">
            <dt>CA net</dt>
            <dd>{formatBackendMoney(summary.net_sales ?? summary.gross_sales)}</dd>
          </div>
          <div>
            <dt>Retours</dt>
            <dd>− {formatBackendMoney(summary.returns_total ?? "0.00")}</dd>
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
            <dd>{formatBackendMoney(summary.counted_cash ?? "0.00")}</dd>
          </div>
          <div className={`cash-difference cash-difference-${difference.kind}`}>
            <dt>Écart</dt>
            <dd>{difference.label}</dd>
          </div>
        </dl>

        <div className="closing-result-actions">
          <Link
            className="button button-secondary"
            to={`/cash-sessions/${encodeURIComponent(summary.id)}/report`}
          >
            Voir le rapport Z
          </Link>
          <button className="button button-primary" type="button" onClick={onFinish}>
            Terminer
          </button>
        </div>
      </section>
    </main>
  )
}
