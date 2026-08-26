import { Button, ButtonLink } from "../../components/ui/Button"
import { MetaList } from "../../components/ui/Metadata"
import { Money } from "../../components/ui/Money"
import { PageHeader } from "../../components/layout/PageHeader"
import { SectionHeader } from "../../components/ui/SectionHeader"
import { useFocusOnMount } from "../../hooks/useFocusOnMount"
import type { CashSessionSummary } from "../../types/api"
import { formatDateTime } from "../../utils/date"
import { describeCashDifference } from "../../utils/money"

type CashClosingResultProps = {
  summary: CashSessionSummary
  onFinish: () => void
}

/**
 * Succès de clôture. Même grammaire que la vente et le retour : marque de
 * statut → titre → résultat clé (l'écart) → action primaire → secondaire.
 */
export function CashClosingResult({ summary, onFinish }: CashClosingResultProps) {
  const difference = describeCashDifference(summary.cash_difference ?? "0.00")
  // Le focus repart du résultat, pas du haut du document.
  const headingRef = useFocusOnMount<HTMLHeadingElement>()

  return (
    <main className="operational-page operational-page-narrow closing-result-page">
      <PageHeader
        eyebrow="Fin de journée"
        title="Caisse clôturée"
        context={summary.cash_register.name}
      />
      <section className="operational-card closing-sheet closing-result-state" aria-live="polite">
        <div className="closing-result-intro">
          <div className="success-mark" aria-hidden="true">✓</div>
          <div>
            <h2 ref={headingRef} tabIndex={-1}>
              Session terminée
            </h2>
            <p className="metadata">Les ventes et les montants de cette caisse ont été enregistrés.</p>
          </div>
        </div>

        {/* Résultat clé de cet écran : l'écart de caisse. */}
        <div className={`closing-result-headline cash-difference-${difference.kind}`}>
          <span>Écart de caisse</span>
          <strong>{difference.label}</strong>
        </div>

        <MetaList
          columns={2}
          label="Informations de la session"
          items={[
            { label: "Caissier", value: summary.cashier.username },
            ...(summary.closed_at
              ? [{ label: "Clôture", value: formatDateTime(summary.closed_at) }]
              : []),
          ]}
        />

        <div className="card-section">
          <SectionHeader eyebrow="Résultat" title="Résumé de clôture" />
          <dl className="closing-summary closing-result-summary" aria-label="Résultat de clôture">
            <div className="closing-summary-kpi">
              <dt>Nombre de ventes</dt>
              <dd>{summary.sales_count}</dd>
            </div>
            <div className="closing-summary-kpi">
              <dt>CA net</dt>
              <dd><Money backend={summary.net_sales ?? summary.gross_sales} /></dd>
            </div>
            <div>
              <dt>Retours</dt>
              <dd><Money backend={summary.returns_total ?? "0.00"} sign="minus" /></dd>
            </div>
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
              <dd><Money backend={summary.counted_cash ?? "0.00"} /></dd>
            </div>
          </dl>
        </div>

        <div className="closing-result-actions">
          <ButtonLink
            variant="secondary"
            to={`/cash-sessions/${encodeURIComponent(summary.id)}/report`}
          >
            Voir le rapport Z
          </ButtonLink>
          <Button variant="primary" onClick={onFinish}>
            Terminer
          </Button>
        </div>
      </section>
    </main>
  )
}
