import { type FormEvent, useMemo, useRef, useState } from "react"

import { Button } from "../../components/ui/Button"
import { Dialog, DialogFooter } from "../../components/ui/Dialog"
import { InlineAlert } from "../../components/ui/InlineAlert"
import { Money } from "../../components/ui/Money"
import { parseMoneyInput } from "../../utils/money"
import { getSuggestedCashAmounts } from "./cashSuggestions"
import { useSlowSubmitHint } from "./useSlowSubmitHint"

type CashPaymentModalProps = {
  total: number
  onClose: () => void
  onConfirm: (receivedAmount: number) => void | Promise<void>
  isSubmitting?: boolean
  errorMessage?: string | null
  onBack?: () => void
}

export function CashPaymentModal({
  total,
  onClose,
  onConfirm,
  isSubmitting = false,
  errorMessage = null,
  onBack,
}: CashPaymentModalProps) {
  const submissionLock = useRef(false)
  const receivedInputRef = useRef<HTMLInputElement>(null)
  const isSlow = useSlowSubmitHint(isSubmitting)
  const [receivedInput, setReceivedInput] = useState("")
  const receivedAmount = parseMoneyInput(receivedInput)
  const isSufficient = receivedAmount !== null && receivedAmount >= total
  const changeAmount = isSufficient ? receivedAmount - total : 0
  const missingAmount = Math.max(total - (receivedAmount ?? 0), 0)
  const quickAmounts = useMemo(
    () =>
      [...new Set([total, ...getSuggestedCashAmounts(total)])].sort(
        (left, right) => left - right,
      ),
    [total],
  )

  // Keep focus on the amount field after every keypad/quick-amount tap, so
  // a physical Enter always submits the form instead of re-activating
  // whichever on-screen button last had focus.
  function refocusReceivedInput() {
    receivedInputRef.current?.focus()
  }

  function handleInput(value: string) {
    if (/^[\d\s]*$/.test(value)) setReceivedInput(value)
  }

  function handleKeypadDigit(digit: string) {
    setReceivedInput((current) => current + digit)
    refocusReceivedInput()
  }

  function handleKeypadBackspace() {
    setReceivedInput((current) => current.slice(0, -1))
    refocusReceivedInput()
  }

  function handleKeypadClear() {
    setReceivedInput("")
    refocusReceivedInput()
  }

  function handleQuickAmount(amount: number) {
    setReceivedInput(String(amount))
    refocusReceivedInput()
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
    <Dialog
      eyebrow="Encaissement"
      title="Paiement en espèces"
      onClose={onClose}
      // A CASH screen reached from payment-method selection backs out one
      // step at a time; only a bare modal (no onBack) closes outright.
      onBack={onBack}
      backLabel="Changer de moyen de paiement"
      backDisabled={isSubmitting}
      dismissible={!isSubmitting}
    >
      <form className="dialog-body cash-payment-form" onSubmit={handleSubmit}>
        <div className="payment-total">
          <span>Total à payer</span>
          <strong>
            <Money value={total} />
          </strong>
        </div>

        <div className="field">
          <label htmlFor="received-amount">Montant reçu</label>
          <div className="money-input payment-money-input">
            <input
              ref={receivedInputRef}
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

        <div className="numeric-keypad" aria-label="Pavé numérique">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => (
            <button
              key={digit}
              className="numeric-keypad-key"
              type="button"
              disabled={isSubmitting}
              aria-label={`Chiffre ${digit}`}
              onClick={() => handleKeypadDigit(digit)}
            >
              {digit}
            </button>
          ))}
          <button
            className="numeric-keypad-key numeric-keypad-clear"
            type="button"
            disabled={isSubmitting || receivedInput === ""}
            aria-label="Effacer le montant"
            onClick={handleKeypadClear}
          >
            C
          </button>
          <button
            className="numeric-keypad-key"
            type="button"
            disabled={isSubmitting}
            aria-label="Chiffre 0"
            onClick={() => handleKeypadDigit("0")}
          >
            0
          </button>
          <button
            className="numeric-keypad-key numeric-keypad-backspace"
            type="button"
            disabled={isSubmitting || receivedInput === ""}
            aria-label="Supprimer le dernier chiffre"
            onClick={handleKeypadBackspace}
          >
            ⌫
          </button>
        </div>

        <div className="quick-amounts" aria-label="Montants rapides">
          {quickAmounts.map((amount) => (
            <Button
              key={amount}
              variant="secondary"
              className="quick-amount"
              disabled={isSubmitting}
              onClick={() => handleQuickAmount(amount)}
            >
              {amount === total ? "Montant exact" : <Money value={amount} />}
            </Button>
          ))}
        </div>

        {/* Information contextuelle, pas une notification : elle appartient à
            l'écran de paiement et doit rester lisible tant qu'il est ouvert. */}
        <div
          className={isSufficient ? "change-preview" : "change-preview change-preview-pending"}
          role={receivedAmount !== null && !isSufficient ? "alert" : undefined}
          aria-live="polite"
        >
          <span>{isSufficient ? "Monnaie à rendre" : "Reste à recevoir"}</span>
          <strong>
            <Money value={isSufficient ? changeAmount : missingAmount} />
          </strong>
        </div>

        {errorMessage ? <InlineAlert tone="error">{errorMessage}</InlineAlert> : null}
        {isSubmitting && isSlow ? (
          <p className="dialog-hint" role="status">
            Ça prend plus de temps que prévu, patientez encore un instant…
          </p>
        ) : null}

        <DialogFooter>
          <Button variant="secondary" disabled={isSubmitting} onClick={onClose}>
            Annuler
          </Button>
          <Button
            variant="primary"
            type="submit"
            disabled={!isSufficient}
            loading={isSubmitting}
            loadingLabel="Validation…"
          >
            Valider
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}
