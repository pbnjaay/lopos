import { useQuery } from "@tanstack/react-query"
import { useParams, useSearchParams } from "react-router-dom"

import { getCustomerPayment } from "../api/customers"
import { PageHeader } from "../components/layout/PageHeader"
import { ReceiptHeading, ReceiptSignature } from "../components/receipt/ReceiptHeading"
import { Button } from "../components/ui/Button"
import { Money } from "../components/ui/Money"
import { RouteError, RouteLoading } from "../components/ui/RouteState"
import { PAYMENT_LABELS } from "../features/sales/paymentLabels"
import { formatDateTime } from "../utils/date"
import { maskPhone } from "../utils/phone"

/**
 * Reçu d'un remboursement de cahier : ce que le client a payé, comment, et
 * ce qu'il doit encore. C'est sa preuve de paiement — l'ancien et le nouveau
 * solde y figurent tels que le serveur les a calculés à l'encaissement.
 */
export function CustomerPaymentReceiptPage() {
  const { paymentId } = useParams<{ paymentId: string }>()
  const [searchParams] = useSearchParams()
  const cashSessionId = searchParams.get("cash_session_id") ?? undefined
  const paymentQuery = useQuery({
    queryKey: ["customer-payments", paymentId, cashSessionId],
    queryFn: () => getCustomerPayment(paymentId!, cashSessionId),
    enabled: Boolean(paymentId),
    retry: false,
  })

  if (!paymentId) {
    return <RouteError context="ticket" title="Reçu introuvable" description="Ce reçu n’existe pas." />
  }
  if (paymentQuery.isLoading) return <RouteLoading message="Chargement du reçu…" />
  if (paymentQuery.error || !paymentQuery.data) {
    return (
      <RouteError error={paymentQuery.error} context="ticket" onRetry={() => void paymentQuery.refetch()} />
    )
  }

  const payment = paymentQuery.data
  const changeAmount = Number(payment.change_amount ?? 0)

  return (
    <main className="operational-page operational-page-narrow receipt-screen-page">
      <div className="no-print">
        <PageHeader
          backTo={`/customers/${payment.customer.id}`}
          backLabel="Retour au client"
          eyebrow={`Paiement ${payment.reference}`}
          title="Reçu de paiement"
          context={`${payment.store.name} · ${payment.cash_register.name}`}
          actions={
            <Button variant="primary" size="sm" onClick={() => window.print()}>
              Imprimer le reçu
            </Button>
          }
        />
      </div>

      <article className="receipt" aria-label="Reçu de paiement">
        <ReceiptHeading
          storeName={payment.store.name}
          documentTitle="Reçu de paiement"
          referenceLabel="N° reçu"
          reference={payment.reference}
          createdAt={formatDateTime(payment.created_at)}
          cashRegisterName={payment.cash_register.name}
          cashierName={payment.created_by}
          secondaryLine={
            <>
              Client : {payment.customer.name}
              {payment.customer.phone ? ` · ${maskPhone(payment.customer.phone)}` : ""}
            </>
          }
        />

        <dl className="receipt-totals">
          <div className="receipt-total">
            <dt>Montant payé</dt>
            <dd><Money backend={payment.amount} /></dd>
          </div>
          <div>
            <dt>Paiement</dt>
            <dd>{PAYMENT_LABELS[payment.method]}</dd>
          </div>
          {payment.received_amount !== null ? (
            <div>
              <dt>Reçu</dt>
              <dd><Money backend={payment.received_amount} /></dd>
            </div>
          ) : null}
          {changeAmount > 0 ? (
            <div>
              <dt>Monnaie</dt>
              <dd><Money backend={payment.change_amount!} /></dd>
            </div>
          ) : null}
          <div>
            <dt>Ancien solde</dt>
            <dd><Money backend={payment.balance_before} /></dd>
          </div>
          <div className="receipt-net-total">
            <dt>Nouveau solde</dt>
            <dd><Money backend={payment.balance_after} /></dd>
          </div>
        </dl>

        <footer className="receipt-footer">
          {Number(payment.balance_after) === 0 ? "Cahier soldé. Merci !" : "Merci !"}
          <ReceiptSignature />
        </footer>
      </article>
    </main>
  )
}
