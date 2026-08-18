import { useEffect, useRef } from "react"

import type { PaymentMethod } from "../../types/api"
import { formatMoney } from "../../utils/money"
import { useSlowSubmitHint } from "./useSlowSubmitHint"

type MobileMoneyConfirmationProps = {
  method: Exclude<PaymentMethod, "CASH">
  total: number
  isSubmitting: boolean
  errorMessage?: string | null
  onClose: () => void
  onBack: () => void
  onConfirm: () => void | Promise<void>
}

const labels: Record<Exclude<PaymentMethod, "CASH">, string> = {
  WAVE: "Wave",
  ORANGE_MONEY: "Orange Money",
}

export function MobileMoneyConfirmation({
  method,
  total,
  isSubmitting,
  errorMessage = null,
  onClose,
  onBack,
  onConfirm,
}: MobileMoneyConfirmationProps) {
  const submissionLock = useRef(false)
  const isSlow = useSlowSubmitHint(isSubmitting)
  const label = labels[method]

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !isSubmitting) onClose()
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [isSubmitting, onClose])

  async function handleConfirm() {
    if (submissionLock.current || isSubmitting) return
    submissionLock.current = true
    try {
      await onConfirm()
    } catch {
      // The parent mutation exposes the backend error through errorMessage.
    } finally {
      submissionLock.current = false
    }
  }

  return (
    <div className="modal-backdrop">
      <section
        className="checkout-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mobile-payment-title"
      >
        <header className="checkout-modal-header">
          <div>
            <p className="eyebrow">Paiement mobile</p>
            <button
              className="payment-back-button"
              type="button"
              disabled={isSubmitting}
              onClick={onBack}
            >
              ← Changer de moyen de paiement
            </button>
            <h2 id="mobile-payment-title">Paiement {label}</h2>
          </div>
          <button
            className="modal-close"
            type="button"
            aria-label="Fermer"
            disabled={isSubmitting}
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div className="mobile-payment-content">
          <div className="payment-total">
            <span>Total à payer</span>
            <strong>{formatMoney(total)}</strong>
          </div>
          <div className={`mobile-payment-instructions mobile-payment-${method.toLowerCase()}`}>
            <strong>Demandez au client d’effectuer le paiement {label}.</strong>
            <span>Vérifiez sa réception sur le téléphone avant de confirmer.</span>
          </div>
          {errorMessage ? (
            <p className="form-error" role="alert">
              {errorMessage}
            </p>
          ) : null}
          {isSubmitting && isSlow ? (
            <p className="muted" role="status">
              Ça prend plus de temps que prévu, patientez encore un instant…
            </p>
          ) : null}
          <div className="modal-actions">
            <button
              className="button button-secondary"
              type="button"
              disabled={isSubmitting}
              onClick={onClose}
            >
              Annuler
            </button>
            <button
              className="button button-primary"
              type="button"
              disabled={isSubmitting}
              onClick={() => void handleConfirm()}
            >
              {isSubmitting ? "Validation…" : "Paiement reçu"}
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}
