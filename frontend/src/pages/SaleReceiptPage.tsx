import { useQuery } from "@tanstack/react-query"
import { useParams, useSearchParams } from "react-router-dom"

import { getSaleReceipt } from "../api/sales"
import { PageHeader } from "../components/layout/PageHeader"
import { ReceiptHeading } from "../components/receipt/ReceiptHeading"
import { Button } from "../components/ui/Button"
import { Money } from "../components/ui/Money"
import { RouteError, RouteLoading } from "../components/ui/RouteState"
import { getLocalSaleById } from "../db/sales"
import { receiptViewFromApiReceipt, receiptViewFromLocalSale } from "../features/sales/receiptView"
import { formatDateTime } from "../utils/date"
import { formatMoney } from "../utils/money"
import { formatQuantity, lineTotal } from "../utils/quantity"

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
  const hasReturns = receipt.returnedTotal > 0
  const isFullyReturned = hasReturns && receipt.returnedTotal >= receipt.total
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
        <ReceiptHeading
          titleId="receipt-title"
          storeName={receipt.storeName}
          documentTitle="Ticket de vente"
          referenceLabel="N° ticket"
          reference={receipt.id.slice(0, 8).toUpperCase()}
          createdAt={formatDateTime(receipt.createdAt)}
          cashRegisterName={receipt.cashRegisterName}
          cashierName={receipt.cashierName}
          note={receipt.isPendingSync ? (
            <p className="receipt-pending-note">
              Vente hors ligne — référence locale : {receipt.id.slice(0, 8).toUpperCase()}
            </p>
          ) : null}
        />

        {hasReturns ? (
          <p className="receipt-return-status">
            <strong>{isFullyReturned ? "Retour total" : "Retour partiel"}</strong>
            <span><Money value={receipt.returnedTotal} sign="minus" /> remboursés</span>
          </p>
        ) : null}

        <ul className="receipt-items" aria-label="Articles vendus">
          {receipt.items.map((item) => {
            const remainingQuantity = Math.max(0, item.quantityMilli - item.returnedQuantityMilli)
            const itemFullyReturned = item.returnedQuantityMilli >= item.quantityMilli
            return (
              <li key={item.productId}>
                <strong>{item.productName}</strong>
                <div>
                  <span>
                    {formatQuantity(item.quantityMilli, item.saleUnit)} × {formatMoney(item.unitPrice)}{item.saleUnit === "KG" ? "/kg" : ""}
                  </span>
                  <span><Money value={item.lineTotal} /></span>
                </div>
                {item.returnedQuantityMilli > 0 ? (
                  <div className="receipt-item-return">
                    <span>
                      ↳ {itemFullyReturned
                        ? `Entièrement retourné (${formatQuantity(item.returnedQuantityMilli, item.saleUnit)})`
                        : `Retourné : ${formatQuantity(item.returnedQuantityMilli, item.saleUnit)} · Reste : ${formatQuantity(remainingQuantity, item.saleUnit)}`}
                    </span>
                    <span>
                      <Money
                        value={lineTotal(item.unitPrice, item.returnedQuantityMilli)}
                        sign="minus"
                      />
                    </span>
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>

        <dl className="receipt-totals">
          <div className="receipt-total">
            <dt>{hasReturns ? "Total de la vente" : "Total"}</dt>
            <dd><Money value={receipt.total} /></dd>
          </div>
          {hasReturns ? (
            <>
              <div className="receipt-returned-total">
                <dt>Remboursements</dt>
                <dd><Money value={receipt.returnedTotal} sign="minus" /></dd>
              </div>
              <div className="receipt-net-total">
                <dt>Total net</dt>
                <dd><Money value={receipt.netTotal} /></dd>
              </div>
            </>
          ) : null}
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

        <footer className="receipt-footer">
          {hasReturns ? (
            <>
              <strong>Vente {isFullyReturned ? "entièrement" : "partiellement"} retournée</strong>
              <span>Le ticket de retour constitue le justificatif du remboursement.</span>
            </>
          ) : "Merci !"}
        </footer>
      </article>
    </main>
  )
}
