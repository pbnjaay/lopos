import { useEffect, useRef, useState } from "react"

import { Button } from "../../components/ui/Button"
import { Dialog, DialogFooter } from "../../components/ui/Dialog"
import { InlineAlert } from "../../components/ui/InlineAlert"
import { Money } from "../../components/ui/Money"
import { parseMoneyInput } from "../../utils/money"
import type { PaymentMethod } from "../../types/api"
import { useSlowSubmitHint } from "./useSlowSubmitHint"

type MobileMoneyConfirmationProps = {
  method: Exclude<PaymentMethod, "CASH">
  /** Montant à couvrir maintenant — le total, ou le reste dû après un premier versement. */
  total: number
  /** true dès qu'un versement a déjà été appliqué (paiement mixte en cours). */
  isPartial?: boolean
  isSubmitting: boolean
  errorMessage?: string | null
  onClose: () => void
  onBack: () => void
  onConfirm: (amount: number) => void | Promise<void>
}

const labels: Record<Exclude<PaymentMethod, "CASH">, string> = {
  WAVE: "Wave",
  ORANGE_MONEY: "Orange Money",
}

export function MobileMoneyConfirmation({
  method,
  total,
  isPartial = false,
  isSubmitting,
  errorMessage = null,
  onClose,
  onBack,
  onConfirm,
}: MobileMoneyConfirmationProps) {
  const submissionLock = useRef(false)
  const isSlow = useSlowSubmitHint(isSubmitting)
  const label = labels[method]
  // Pré-rempli avec le montant plein : le cas courant (un seul paiement)
  // reste un simple clic, sans rien à taper. Modifiable uniquement pour un
  // versement partiel d'un paiement mixte.
  const [amountInput, setAmountInput] = useState(String(total))
  const amount = parseMoneyInput(amountInput)
  // Aucune monnaie possible sur un paiement mobile : contrairement aux
  // espèces, un montant supérieur au reste dû est un mauvais chiffre saisi,
  // jamais un versement volontairement excédentaire.
  const canSubmit = amount !== null && amount > 0 && amount <= total
  const exceedsTotal = amount !== null && amount > total

  function handleAmountChange(value: string) {
    if (/^[\d\s]*$/.test(value)) setAmountInput(value)
  }

  async function handleConfirm() {
    if (submissionLock.current || isSubmitting || !canSubmit) return
    submissionLock.current = true
    try {
      await onConfirm(amount!)
    } catch {
      // The parent mutation exposes the backend error through errorMessage.
    } finally {
      submissionLock.current = false
    }
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.repeat || isSubmitting) return
      if (event.key !== "Enter") return
      // Never auto-submit just from selecting Wave/OM (F2/F3): a mobile
      // money sale still requires this explicit confirmation, same as a
      // click on "Paiement reçu".
      event.preventDefault()
      void handleConfirm()
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [isSubmitting, canSubmit, amount])

  return (
    <Dialog
      eyebrow="Paiement mobile"
      title={`Paiement ${label}`}
      onClose={onClose}
      onBack={onBack}
      backLabel="Changer de moyen de paiement"
      backDisabled={isSubmitting}
      dismissible={!isSubmitting}
    >
      <div className="dialog-body">
        <div className="payment-total">
          <span>{isPartial ? "Reste à payer" : "Total à payer"}</span>
          <strong>
            <Money value={total} />
          </strong>
        </div>
        <div className="mobile-payment-instructions">
          <strong>Demandez au client d’effectuer le paiement {label}.</strong>
          <span>Vérifiez sa réception sur le téléphone avant de confirmer.</span>
        </div>

        <div className="field">
          <label htmlFor="mobile-money-amount">Montant reçu</label>
          <div className="money-input payment-money-input">
            <input
              id="mobile-money-amount"
              inputMode="numeric"
              value={amountInput}
              disabled={isSubmitting}
              onChange={(event) => handleAmountChange(event.target.value)}
            />
            <span>FCFA</span>
          </div>
          {exceedsTotal ? (
            <small role="alert">
              Un paiement {label} ne rend pas la monnaie — le montant ne peut
              pas dépasser {isPartial ? "le reste à payer" : "le total"}.
            </small>
          ) : null}
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
            disabled={!canSubmit}
            loading={isSubmitting}
            loadingLabel="Validation…"
            onClick={() => void handleConfirm()}
          >
            {amount !== null && amount < total ? "Continuer avec un autre moyen" : "Paiement reçu"}
          </Button>
        </DialogFooter>
      </div>
    </Dialog>
  )
}
