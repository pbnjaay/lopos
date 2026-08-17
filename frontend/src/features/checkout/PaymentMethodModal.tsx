import { useEffect } from "react"

import type { PaymentMethod } from "../../types/api"
import { formatMoney } from "../../utils/money"

type PaymentMethodModalProps = {
  total: number
  onClose: () => void
  onSelect: (method: PaymentMethod) => void
}

const methods: Array<{ method: PaymentMethod; label: string; description: string }> = [
  { method: "CASH", label: "Espèces", description: "Saisir le montant reçu et calculer la monnaie" },
  { method: "WAVE", label: "Wave", description: "Confirmer manuellement la réception du paiement" },
  {
    method: "ORANGE_MONEY",
    label: "Orange Money",
    description: "Confirmer manuellement la réception du paiement",
  },
]

export function PaymentMethodModal({ total, onClose, onSelect }: PaymentMethodModalProps) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [onClose])

  return (
    <div className="modal-backdrop">
      <section
        className="checkout-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="payment-method-title"
      >
        <header className="checkout-modal-header">
          <div>
            <p className="eyebrow">Encaissement</p>
            <h2 id="payment-method-title">Mode de paiement</h2>
          </div>
          <button className="modal-close" type="button" aria-label="Fermer" onClick={onClose}>
            ×
          </button>
        </header>

        <div className="payment-method-content">
          <div className="payment-total">
            <span>Total à payer</span>
            <strong>{formatMoney(total)}</strong>
          </div>
          <div className="payment-method-list">
            {methods.map(({ method, label, description }) => (
              <button
                key={method}
                className={`payment-method-card payment-method-${method.toLowerCase()}`}
                type="button"
                onClick={() => onSelect(method)}
              >
                <span className="payment-method-copy">
                  <strong>{label}</strong>
                  <small>{description}</small>
                </span>
                <span className="payment-method-arrow" aria-hidden="true">→</span>
              </button>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}
