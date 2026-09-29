import type { ReactNode } from "react"

import { Money } from "../../components/ui/Money"
import type { CashSessionSummary } from "../../types/api"
import { describeCashDifference } from "../../utils/money"

const ZERO = "0.00"

function isNonZero(value: string | undefined): boolean {
  return Number(value ?? 0) !== 0
}

function ReportSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="report-section" aria-label={title}>
      <h2 className="report-section-title">{title}</h2>
      <dl className="closing-summary report-totals">{children}</dl>
    </section>
  )
}

function Row({
  label,
  value,
  sign,
  className,
}: {
  label: string
  value: string
  sign?: "minus"
  className?: string
}) {
  return (
    <div className={className}>
      <dt>{label}</dt>
      <dd>
        <Money backend={value} sign={sign} />
      </dd>
    </div>
  )
}

/**
 * Corps du rapport Z, en sections : ce qui a été vendu, comment c'est entré,
 * ce qui est ressorti, ce que le cahier a bougé, puis le tiroir-caisse.
 *
 * Les dépenses ne sont jamais des ventes : elles ont leur section, et seule
 * leur part en espèces sort du tiroir.
 *
 * Le cahier sépare trois choses que le Z ne doit jamais mélanger : une vente
 * mise au cahier n'est pas de l'argent reçu, un paiement de client n'est pas
 * une vente, un retour déduit du cahier n'est pas de l'argent rendu. Les
 * lignes du cahier n'apparaissent que si la session en a eu.
 */
export function ZReportTotals({ summary }: { summary: CashSessionSummary }) {
  const difference = describeCashDifference(summary.cash_difference ?? ZERO)
  const customerPayments = summary.customer_payments
  const hasCustomerPayments =
    customerPayments !== undefined &&
    (isNonZero(customerPayments.cash) ||
      isNonZero(customerPayments.wave) ||
      isNonZero(customerPayments.orange_money))
  const hasCredit = isNonZero(summary.credit_sales) || isNonZero(summary.credit_returns)
  const hasBook = hasCredit || hasCustomerPayments
  const cashRefunds = summary.refunds?.cash ?? ZERO
  const expenses = summary.expenses
  const hasExpenses =
    expenses !== undefined &&
    (isNonZero(expenses.cash) || isNonZero(expenses.wave) || isNonZero(expenses.orange_money))
  const cashExpenses = expenses?.cash ?? ZERO

  return (
    <>
      <ReportSection title="Ventes">
        <div className="closing-summary-total">
          <dt>Nombre de ventes</dt>
          <dd>{summary.sales_count}</dd>
        </div>
        <Row label="Ventes brutes" value={summary.gross_sales} className="closing-summary-total" />
        {summary.returns_total !== undefined ? (
          <Row label="Retours" value={summary.returns_total} sign="minus" />
        ) : null}
        {summary.net_sales !== undefined ? (
          <Row label="CA net" value={summary.net_sales} className="closing-summary-total" />
        ) : null}
      </ReportSection>

      <ReportSection title="Encaissements des ventes">
        <Row label="Espèces" value={summary.payments.cash} />
        <Row label="Wave" value={summary.payments.wave} />
        <Row label="Orange Money" value={summary.payments.orange_money} />
        {isNonZero(summary.credit_sales) ? (
          <Row label="Mis au cahier" value={summary.credit_sales!} />
        ) : null}
      </ReportSection>

      {summary.refunds ? (
        <ReportSection title="Remboursements des retours">
          <Row label="Espèces" value={summary.refunds.cash} sign="minus" />
          <Row label="Wave" value={summary.refunds.wave} sign="minus" />
          <Row label="Orange Money" value={summary.refunds.orange_money} sign="minus" />
          {isNonZero(summary.credit_returns) ? (
            <Row label="Déduits du cahier" value={summary.credit_returns!} sign="minus" />
          ) : null}
        </ReportSection>
      ) : null}

      {hasBook ? (
        <ReportSection title="Cahier clients">
          <Row label="Nouveau crédit" value={summary.credit_sales ?? ZERO} />
          {isNonZero(summary.credit_returns) ? (
            <Row label="Retours déduits" value={summary.credit_returns!} sign="minus" />
          ) : null}
          <Row label="Paiements clients espèces" value={customerPayments?.cash ?? ZERO} />
          <Row label="Paiements clients Wave" value={customerPayments?.wave ?? ZERO} />
          <Row label="Paiements clients Orange Money" value={customerPayments?.orange_money ?? ZERO} />
        </ReportSection>
      ) : null}

      {hasExpenses ? (
        <ReportSection title="Dépenses">
          <Row label="Espèces" value={expenses!.cash} sign="minus" />
          <Row label="Wave" value={expenses!.wave} sign="minus" />
          <Row label="Orange Money" value={expenses!.orange_money} sign="minus" />
        </ReportSection>
      ) : null}

      <ReportSection title="Espèces en caisse">
        <Row label="Fond initial" value={summary.opening_balance} className="closing-summary-opening" />
        {/* Le détail n'apparaît que lorsqu'il ajoute quelque chose : sans
            cahier ni retour, « attendu » est simplement fond + ventes. */}
        {hasCustomerPayments || isNonZero(cashRefunds) || isNonZero(cashExpenses) ? (
          <>
            <Row label="+ Ventes en espèces" value={summary.payments.cash} />
            {hasCustomerPayments && isNonZero(customerPayments?.cash) ? (
              <Row label="+ Paiements clients en espèces" value={customerPayments!.cash} />
            ) : null}
            {isNonZero(cashRefunds) ? (
              <Row label="− Remboursements en espèces" value={cashRefunds} />
            ) : null}
            {isNonZero(cashExpenses) ? (
              <Row label="− Dépenses en espèces" value={cashExpenses} />
            ) : null}
          </>
        ) : null}
        <Row label="Cash attendu" value={summary.expected_cash} className="closing-summary-total" />
        <div>
          <dt>Cash compté</dt>
          <dd>
            {summary.counted_cash === null ? "Non compté" : <Money backend={summary.counted_cash} />}
          </dd>
        </div>
        <div className={`cash-difference cash-difference-${difference.kind}`}>
          <dt>Écart</dt>
          <dd>{summary.cash_difference === null ? "Non disponible" : difference.label}</dd>
        </div>
      </ReportSection>
    </>
  )
}
