import type { ReceiptView } from "../sales/receiptView"
import { formatMoney } from "../../utils/money"

type SaleSuccessModalProps = {
  sale: ReceiptView
  onNewSale: () => void
}

export function SaleSuccessModal({ sale, onNewSale }: SaleSuccessModalProps) {
  const paymentLabel = {
    CASH: "Espèces",
    WAVE: "Wave",
    ORANGE_MONEY: "Orange Money",
  }[sale.payment.method]

  return (
    <div className="modal-backdrop">
      <section
        className="checkout-modal sale-success-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sale-success-title"
      >
        <div className="success-mark" aria-hidden="true">
          ✓
        </div>
        <p className="eyebrow">Vente terminée</p>
        <h2 id="sale-success-title">Vente validée</h2>

        {sale.isPendingSync ? (
          <p className="sale-pending-note">
            Vente enregistrée hors ligne. Référence locale :{" "}
            {sale.id.slice(0, 8).toUpperCase()}
          </p>
        ) : null}

        <dl className="sale-amounts">
          <div>
            <dt>Paiement</dt>
            <dd>{paymentLabel}</dd>
          </div>
          <div>
            <dt>Total</dt>
            <dd>{formatMoney(sale.total)}</dd>
          </div>
          {sale.payment.receivedAmount !== null ? (
            <div>
              <dt>Reçu</dt>
              <dd>{formatMoney(sale.payment.receivedAmount)}</dd>
            </div>
          ) : null}
          {sale.payment.changeAmount !== null ? (
            <div className="sale-change">
              <dt>Monnaie</dt>
              <dd>{formatMoney(sale.payment.changeAmount)}</dd>
            </div>
          ) : null}
        </dl>

        <div className="sale-success-actions">
          <a
            className="button button-secondary receipt-link"
            href={`/sales/${encodeURIComponent(sale.id)}/receipt`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Imprimer le ticket
          </a>
          <button className="button button-primary" type="button" onClick={onNewSale}>
            Nouvelle vente
          </button>
        </div>
      </section>
    </div>
  )
}
