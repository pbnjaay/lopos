import { useEffect, useRef } from "react"

import type { PaymentMethod } from "../../types/api"
import { formatMoney } from "../../utils/money"

type PaymentMethodModalProps = {
  total: number
  lastUsedMethod?: PaymentMethod | null
  onClose: () => void
  onSelect: (method: PaymentMethod) => void
}

const methods: Array<{
  method: PaymentMethod
  shortcut: "1" | "2" | "3"
  label: string
  description: string
}> = [
  {
    method: "CASH",
    shortcut: "1",
    label: "Espèces",
    description: "Saisir le montant reçu et calculer la monnaie",
  },
  {
    method: "WAVE",
    shortcut: "2",
    label: "Wave",
    description: "Confirmer manuellement la réception du paiement",
  },
  {
    method: "ORANGE_MONEY",
    shortcut: "3",
    label: "Orange Money",
    description: "Confirmer manuellement la réception du paiement",
  },
]

const shortcutToMethod: Record<string, PaymentMethod> = {
  "1": "CASH",
  "2": "WAVE",
  "3": "ORANGE_MONEY",
}

export function PaymentMethodModal({
  total,
  lastUsedMethod = null,
  onClose,
  onSelect,
}: PaymentMethodModalProps) {
  const lastUsedButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    lastUsedButtonRef.current?.focus()
  }, [])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose()
        return
      }
      const method = shortcutToMethod[event.key]
      if (method) onSelect(method)
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [onClose, onSelect])

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
            {methods.map(({ method, shortcut, label, description }) => (
              <button
                key={method}
                ref={method === lastUsedMethod ? lastUsedButtonRef : undefined}
                className={`payment-method-card payment-method-${method.toLowerCase()}`}
                type="button"
                onClick={() => onSelect(method)}
              >
                <span className="payment-method-shortcut" aria-hidden="true">
                  {shortcut}
                </span>
                <span className="payment-method-copy">
                  <strong>
                    {label}
                    {method === lastUsedMethod ? (
                      <span className="payment-method-last-used">Dernier utilisé</span>
                    ) : null}
                  </strong>
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
