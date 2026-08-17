import { Link } from "react-router-dom"

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
    <main className="closing-page">
      <section className="closing-sheet closing-result-state" aria-live="polite">
        <div className="success-mark" aria-hidden="true">
          ✓
        </div>
        <p className="eyebrow">Fin de journée</p>
        <h1>Caisse clôturée</h1>
        <div className="closing-identity">
          <strong>{summary.cash_register.name}</strong>
          <span>Caissier : {summary.cashier.username}</span>
          {summary.closed_at ? <span>Clôturée le {formatDateTime(summary.closed_at)}</span> : null}
        </div>

        <dl className="closing-summary closing-result-summary" aria-label="Résultat de clôture">
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
