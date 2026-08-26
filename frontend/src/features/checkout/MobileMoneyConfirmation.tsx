import { useEffect, useRef } from "react"

import { Button } from "../../components/ui/Button"
import { Dialog, DialogFooter } from "../../components/ui/Dialog"
import { InlineAlert } from "../../components/ui/InlineAlert"
import { Money } from "../../components/ui/Money"
import type { PaymentMethod } from "../../types/api"
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
  }, [isSubmitting, onConfirm])

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
          <span>Total à payer</span>
          <strong>
            <Money value={total} />
          </strong>
        </div>
        <div className="mobile-payment-instructions">
          <strong>Demandez au client d’effectuer le paiement {label}.</strong>
          <span>Vérifiez sa réception sur le téléphone avant de confirmer.</span>
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
            loading={isSubmitting}
            loadingLabel="Validation…"
            onClick={() => void handleConfirm()}
          >
            Paiement reçu
          </Button>
        </DialogFooter>
      </div>
    </Dialog>
  )
}
