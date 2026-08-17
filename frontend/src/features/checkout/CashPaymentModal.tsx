import { type FormEvent, useEffect, useMemo, useRef, useState } from "react"

import { formatMoney, parseMoneyInput } from "../../utils/money"

type CashPaymentModalProps = {
  total: number
  onClose: () => void
  onConfirm: (receivedAmount: number) => void | Promise<void>
  isSubmitting?: boolean
  errorMessage?: string | null
  onBack?: () => void
}

const FIXED_QUICK_AMOUNTS = [1_000, 2_000, 5_000, 10_000, 20_000]

export function CashPaymentModal({
  total,
  onClose,
  onConfirm,
  isSubmitting = false,
  errorMessage = null,
  onBack,
}: CashPaymentModalProps) {
  const submissionLock = useRef(false)
  const [receivedInput, setReceivedInput] = useState("")
  const receivedAmount = parseMoneyInput(receivedInput)
  const isSufficient = receivedAmount !== null && receivedAmount >= total
  const changeAmount = isSufficient ? receivedAmount - total : 0
  const missingAmount = receivedAmount === null ? 0 : Math.max(total - receivedAmount, 0)
  const quickAmounts = useMemo(
    () =>
      [...new Set([total, ...FIXED_QUICK_AMOUNTS])]
        .filter((amount) => amount >= total)
        .sort((left, right) => left - right),
    [total],
  )

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !isSubmitting) onClose()
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [isSubmitting, onClose])

  function handleInput(value: string) {
    if (/^[\d\s]*$/.test(value)) setReceivedInput(value)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (
      submissionLock.current ||
      isSubmitting ||
      receivedAmount === null ||
      receivedAmount < total
    ) return

    submissionLock.current = true
    try {
      await onConfirm(receivedAmount)
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
        aria-labelledby="cash-payment-title"
      >
        <header className="checkout-modal-header">
          <div>
            <p className="eyebrow">Encaissement</p>
            {onBack ? (
              <button
                className="payment-back-button"
                type="button"
                disabled={isSubmitting}
                onClick={onBack}
              >
                ← Changer de moyen de paiement
              </button>
            ) : null}
            <h2 id="cash-payment-title">Paiement en espèces</h2>
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

        <form className="cash-payment-form" onSubmit={handleSubmit}>
          <div className="payment-total">
            <span>Total à payer</span>
            <strong>{formatMoney(total)}</strong>
          </div>

          <div className="field">
            <label htmlFor="received-amount">Montant reçu</label>
            <div className="money-input payment-money-input">
              <input
                id="received-amount"
                autoFocus
                inputMode="numeric"
                placeholder="2 000"
                value={receivedInput}
                disabled={isSubmitting}
                onChange={(event) => handleInput(event.target.value)}
              />
              <span>FCFA</span>
            </div>
          </div>

          <div className="quick-amounts" aria-label="Montants rapides">
            {quickAmounts.map((amount) => (
              <button
                key={amount}
                className="button button-secondary quick-amount"
                type="button"
                disabled={isSubmitting}
                onClick={() => setReceivedInput(String(amount))}
              >
                {amount === total ? "Montant exact" : formatMoney(amount)}
              </button>
            ))}
          </div>

          <div className="change-preview" aria-live="polite">
            <span>Monnaie à rendre</span>
            <strong>{formatMoney(changeAmount)}</strong>
          </div>

          {receivedAmount !== null && !isSufficient ? (
            <p className="form-error" role="alert">
              Montant insuffisant : il manque {formatMoney(missingAmount)}.
            </p>
          ) : null}
          {errorMessage ? (
            <p className="form-error" role="alert">
              {errorMessage}
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
              type="submit"
              disabled={!isSufficient || isSubmitting}
            >
              {isSubmitting ? "Validation…" : "Valider"}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}
