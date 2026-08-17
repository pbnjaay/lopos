import type { SaleResponse } from "../../types/api"
import { formatMoney } from "../../utils/money"

type SaleSuccessModalProps = {
  sale: SaleResponse
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

        <dl className="sale-amounts">
          <div>
            <dt>Paiement</dt>
            <dd>{paymentLabel}</dd>
          </div>
          <div>
            <dt>Total</dt>
            <dd>{formatMoney(Number(sale.total))}</dd>
          </div>
          {sale.payment.received_amount !== null ? (
            <div>
              <dt>Reçu</dt>
              <dd>{formatMoney(Number(sale.payment.received_amount))}</dd>
            </div>
          ) : null}
          {sale.payment.change_amount !== null ? (
            <div className="sale-change">
              <dt>Monnaie</dt>
              <dd>{formatMoney(Number(sale.payment.change_amount))}</dd>
            </div>
          ) : null}
        </dl>

        <button className="button button-primary new-sale-button" type="button" onClick={onNewSale}>
          Nouvelle vente
        </button>
      </section>
    </div>
  )
}
