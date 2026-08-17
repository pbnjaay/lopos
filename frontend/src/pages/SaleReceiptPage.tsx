import { useQuery } from "@tanstack/react-query"
import { Link, useParams } from "react-router-dom"

import { getSaleReceipt } from "../api/sales"
import { RouteState } from "../components/ui/RouteState"
import { formatDateTime } from "../utils/date"
import { formatBackendMoney } from "../utils/money"

const paymentLabels = {
  CASH: "Espèces",
  WAVE: "Wave",
  ORANGE_MONEY: "Orange Money",
} as const

export function SaleReceiptPage() {
  const { saleId } = useParams<{ saleId: string }>()
  const receiptQuery = useQuery({
    queryKey: ["sales", saleId, "receipt"],
    queryFn: () => getSaleReceipt(saleId!),
    enabled: Boolean(saleId),
    retry: false,
  })

  if (!saleId) return <RouteState message="Ticket de vente introuvable." />
  if (receiptQuery.isLoading) return <RouteState message="Chargement du ticket…" />
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
  if (!receipt) return <RouteState message="Chargement du ticket…" />
  const isCash = receipt.payment.method === "CASH"

  return (
    <main className="receipt-page">
      <nav className="receipt-actions no-print" aria-label="Actions du ticket">
        <Link className="text-button" to="/pos">
          Retour au POS
        </Link>
        <button className="button button-primary button-small" type="button" onClick={() => window.print()}>
          Imprimer
        </button>
      </nav>

      <article className="receipt" aria-labelledby="receipt-title">
        <header className="receipt-heading">
          <h1 id="receipt-title">{receipt.store.name}</h1>
          <p>{formatDateTime(receipt.created_at)}</p>
          <p>Caisse : {receipt.cash_register.name}</p>
          <p>Caissier : {receipt.cashier.username}</p>
        </header>

        <ul className="receipt-items" aria-label="Articles vendus">
          {receipt.items.map((item) => (
            <li key={item.product_id}>
              <strong>{item.product_name}</strong>
              <div>
                <span>
                  {item.quantity} × {formatBackendMoney(item.unit_price)}
                </span>
                <span>{formatBackendMoney(item.line_total)}</span>
              </div>
            </li>
          ))}
        </ul>

        <dl className="receipt-totals">
          <div className="receipt-total">
            <dt>Total</dt>
            <dd>{formatBackendMoney(receipt.total)}</dd>
          </div>
          <div>
            <dt>Paiement</dt>
            <dd>{paymentLabels[receipt.payment.method]}</dd>
          </div>
          {isCash && receipt.payment.received_amount !== null ? (
            <div>
              <dt>Reçu</dt>
              <dd>{formatBackendMoney(receipt.payment.received_amount)}</dd>
            </div>
          ) : null}
          {isCash && receipt.payment.change_amount !== null ? (
            <div>
              <dt>Monnaie</dt>
              <dd>{formatBackendMoney(receipt.payment.change_amount)}</dd>
            </div>
          ) : null}
        </dl>

        <footer className="receipt-footer">Merci !</footer>
      </article>
    </main>
  )
}
