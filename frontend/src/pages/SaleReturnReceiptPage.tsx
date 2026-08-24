import { useQuery } from "@tanstack/react-query"
import { useParams } from "react-router-dom"

import { getSaleReceipt, getSaleReturn } from "../api/sales"
import { OperationalPageHeader } from "../components/layout/OperationalPageHeader"
import { RouteState } from "../components/ui/RouteState"
import { useCurrentUser } from "../features/auth/queries"
import { usePosSession } from "../features/cash-session/queries"
import type { PaymentMethod } from "../types/api"
import { formatDateTime } from "../utils/date"
import { formatBackendMoney } from "../utils/money"
import { backendQuantityToMilli, formatQuantity } from "../utils/quantity"

const paymentLabels: Record<PaymentMethod, string> = {
  CASH: "Espèces",
  WAVE: "Wave",
  ORANGE_MONEY: "Orange Money",
}

export function SaleReturnReceiptPage() {
  const { returnId } = useParams<{ returnId: string }>()
  const user = useCurrentUser().data!
  const { ownSession } = usePosSession(user)
  const receiptQuery = useQuery({
    queryKey: ["returns", returnId, ownSession?.id, "receipt"],
    queryFn: async () => {
      const saleReturn = await getSaleReturn(returnId!, ownSession!.id)
      const originalSale = await getSaleReceipt(saleReturn.original_sale_id, ownSession!.id)
      return { saleReturn, originalSale }
    },
    enabled: Boolean(returnId && ownSession),
    retry: false,
  })

  if (!returnId) return <RouteState message="Ticket de retour introuvable." />
  if (receiptQuery.isLoading) return <RouteState message="Chargement du ticket de retour…" />
  if (receiptQuery.error) {
    return (
      <RouteState
        message=""
        error={receiptQuery.error}
        onRetry={() => void receiptQuery.refetch()}
      />
    )
  }

  const receipt = receiptQuery.data
  if (!receipt) return <RouteState message="Ticket de retour introuvable." />
  const { saleReturn, originalSale } = receipt

  return (
    <main className="operational-page operational-page-narrow receipt-screen-page">
      <div className="no-print">
        <OperationalPageHeader
          backTo={`/sales/${saleReturn.original_sale_id}`}
          backLabel="Retour à la vente"
          eyebrow={`Retour ${saleReturn.reference}`}
          title="Ticket de retour"
          context={`${originalSale.store.name} · ${originalSale.cash_register.name}`}
          actions={(
            <button className="button button-primary button-small" type="button" onClick={() => window.print()}>
              Imprimer le ticket
            </button>
          )}
        />
      </div>

      <article className="receipt" aria-labelledby="return-receipt-title">
        <header className="receipt-heading">
          <h1 id="return-receipt-title">{originalSale.store.name}</h1>
          <p><strong>N° retour : {saleReturn.reference}</strong></p>
          <p>Ticket d’origine : {saleReturn.original_sale_id.slice(0, 8).toUpperCase()}</p>
          <p>{formatDateTime(saleReturn.created_at)}</p>
          <p>Caisse : {originalSale.cash_register.name}</p>
          <p>Caissier : {originalSale.cashier.username}</p>
        </header>

        <ul className="receipt-items" aria-label="Articles retournés">
          {saleReturn.items.map((item) => (
            <li key={item.id}>
              <strong>{item.product_name}</strong>
              <div>
                <span>
                  {formatQuantity(backendQuantityToMilli(item.quantity), item.sale_unit)} × {formatBackendMoney(item.unit_price)}{item.sale_unit === "KG" ? "/kg" : ""}
                </span>
                <span>{formatBackendMoney(item.refund_amount)}</span>
              </div>
              <small>Remis en stock : {item.restock ? "Oui" : "Non"}</small>
            </li>
          ))}
        </ul>

        <dl className="receipt-totals">
          <div className="receipt-total">
            <dt>Total remboursé</dt>
            <dd>{formatBackendMoney(saleReturn.total_refund)}</dd>
          </div>
          <div>
            <dt>Remboursement</dt>
            <dd>{paymentLabels[saleReturn.payment_method]}</dd>
          </div>
        </dl>

        <footer className="receipt-footer">Retour traité</footer>
      </article>
    </main>
  )
}
