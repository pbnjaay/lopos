import { useQuery } from "@tanstack/react-query"
import { useParams, useSearchParams } from "react-router-dom"

import { getSaleReceipt } from "../api/sales"
import { PageHeader } from "../components/layout/PageHeader"
import { Button } from "../components/ui/Button"
import { Money } from "../components/ui/Money"
import { RouteError, RouteLoading } from "../components/ui/RouteState"
import { getLocalSaleById } from "../db/sales"
import { receiptViewFromApiReceipt, receiptViewFromLocalSale } from "../features/sales/receiptView"
import { formatDateTime } from "../utils/date"
import { formatMoney } from "../utils/money"
import { formatQuantity } from "../utils/quantity"

const paymentLabels = {
  CASH: "Espèces",
  WAVE: "Wave",
  ORANGE_MONEY: "Orange Money",
} as const

export function SaleReceiptPage() {
  const { saleId } = useParams<{ saleId: string }>()
  const [searchParams] = useSearchParams()
  const cashSessionId = searchParams.get("cash_session_id") ?? undefined
  const receiptQuery = useQuery({
    queryKey: ["sales", saleId, "receipt", cashSessionId],
    queryFn: async () => {
      const localSale = await getLocalSaleById(saleId!)
      if (localSale) return receiptViewFromLocalSale(localSale)
      return receiptViewFromApiReceipt(await getSaleReceipt(saleId!, cashSessionId))
    },
    enabled: Boolean(saleId),
    retry: false,
  })

  if (!saleId) return <RouteError context="ticket" title="Ticket introuvable" description="Ce ticket n’existe pas ou n’est plus accessible." />
  if (receiptQuery.isLoading) return <RouteLoading message="Chargement du ticket…" />
  if (receiptQuery.error) {
    return (
      <RouteError
        error={receiptQuery.error}
        context="ticket"
        onRetry={() => void receiptQuery.refetch()}
      />
    )
  }

  const receipt = receiptQuery.data
  if (!receipt) return <RouteLoading message="Chargement du ticket…" />
  const isCash = receipt.payment.method === "CASH"
  const source = searchParams.get("from")
  const backDestination = source === "pos"
    ? { to: "/pos", label: "Retour au point de vente" }
    : source === "pending" || receipt.isPendingSync
      ? { to: "/sales/pending", label: "Retour aux ventes en attente" }
      : { to: `/sales/${receipt.id}`, label: "Retour à la vente" }

  return (
    <main className="operational-page operational-page-narrow receipt-screen-page">
      <div className="no-print">
        <PageHeader
          backTo={backDestination.to}
          backLabel={backDestination.label}
          eyebrow={`Ticket ${receipt.id.slice(0, 8).toUpperCase()}`}
          title="Ticket de vente"
          context={`${receipt.storeName} · ${receipt.cashRegisterName}`}
          actions={<Button variant="primary" size="sm" onClick={() => window.print()}>Imprimer le ticket</Button>}
        />
      </div>

      <article className="receipt" aria-labelledby="receipt-title">
        <header className="receipt-heading">
          <h1 id="receipt-title">{receipt.storeName}</h1>
          <p><strong>N° ticket : {receipt.id.slice(0, 8).toUpperCase()}</strong></p>
          <p>{formatDateTime(receipt.createdAt)}</p>
          <p>Caisse : {receipt.cashRegisterName}</p>
          <p>Caissier : {receipt.cashierName}</p>
          {receipt.isPendingSync ? (
            <p className="receipt-pending-note">
              Vente hors ligne — référence locale : {receipt.id.slice(0, 8).toUpperCase()}
            </p>
          ) : null}
        </header>

        <ul className="receipt-items" aria-label="Articles vendus">
          {receipt.items.map((item) => (
            <li key={item.productId}>
              <strong>{item.productName}</strong>
              <div>
                <span>
                  {formatQuantity(item.quantityMilli, item.saleUnit)} × {formatMoney(item.unitPrice)}{item.saleUnit === "KG" ? "/kg" : ""}
                </span>
                <span><Money value={item.lineTotal} /></span>
              </div>
            </li>
          ))}
        </ul>

        <dl className="receipt-totals">
          <div className="receipt-total">
            <dt>Total</dt>
            <dd><Money value={receipt.total} /></dd>
          </div>
          <div>
            <dt>Paiement</dt>
            <dd>{paymentLabels[receipt.payment.method]}</dd>
          </div>
          {isCash && receipt.payment.receivedAmount !== null ? (
            <div>
              <dt>Reçu</dt>
              <dd><Money value={receipt.payment.receivedAmount} /></dd>
            </div>
          ) : null}
          {isCash && receipt.payment.changeAmount !== null ? (
            <div>
              <dt>Monnaie</dt>
              <dd><Money value={receipt.payment.changeAmount} /></dd>
            </div>
          ) : null}
        </dl>

        <footer className="receipt-footer">Merci !</footer>
      </article>
    </main>
  )
}
