import { type FormEvent, useRef } from "react"

import { Button } from "../../components/ui/Button"
import { Dialog, DialogFooter, DialogForm } from "../../components/ui/Dialog"
import { InlineAlert } from "../../components/ui/InlineAlert"
import { Money } from "../../components/ui/Money"
import { formatPhone } from "../../utils/phone"
import type { CustomerSummary } from "../customers/customerService"
import { useSlowSubmitHint } from "./useSlowSubmitHint"

type CreditConfirmationProps = {
  customer: CustomerSummary
  /** Reste dû, inscrit au cahier — toujours le reste exact après les paiements. */
  creditAmount: number
  /** Déjà encaissé sur cette vente (paiement partiel), 0 pour une vente entièrement à crédit. */
  paidAmount: number
  isSubmitting?: boolean
  errorMessage?: string | null
  onConfirm: () => void | Promise<void>
  onBack: () => void
  onClose: () => void
}

/**
 * Dernière étape d'une vente mise au cahier : le caissier voit exactement ce
 * qui sera inscrit, et le solde que le client aura ensuite, avant de valider.
 */
export function CreditConfirmation({
  customer,
  creditAmount,
  paidAmount,
  isSubmitting = false,
  errorMessage = null,
  onConfirm,
  onBack,
  onClose,
}: CreditConfirmationProps) {
  const confirmRef = useRef<HTMLButtonElement>(null)
  const submissionLock = useRef(false)
  const isSlow = useSlowSubmitHint(isSubmitting)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submissionLock.current || isSubmitting) return
    submissionLock.current = true
    try {
      await onConfirm()
    } catch {
      // L'erreur est affichée par le parent via `errorMessage`.
    } finally {
      submissionLock.current = false
    }
  }

  return (
    <Dialog
      eyebrow="Cahier client"
      title="Mettre au cahier"
      onClose={() => {
        if (!isSubmitting) onClose()
      }}
      onBack={onBack}
      backLabel="Changer de client"
      backDisabled={isSubmitting}
      initialFocusRef={confirmRef}
    >
      <DialogForm onSubmit={(event) => void handleSubmit(event)}>
        <div className="credit-confirmation-customer">
          <strong>{customer.name}</strong>
          {customer.phone ? <span>{formatPhone(customer.phone)}</span> : null}
        </div>

        <dl className="sale-amounts">
          {paidAmount > 0 ? (
            <div>
              <dt>Déjà payé</dt>
              <dd>
                <Money value={paidAmount} />
              </dd>
            </div>
          ) : null}
          <div className="sale-credit-amount">
            <dt>À mettre au cahier</dt>
            <dd>
              <Money value={creditAmount} />
            </dd>
          </div>
          <div>
            <dt>Solde actuel</dt>
            <dd>
              <Money value={customer.balance} />
            </dd>
          </div>
          <div>
            <dt>Nouveau solde</dt>
            <dd>
              <strong>
                <Money value={customer.balance + creditAmount} />
              </strong>
            </dd>
          </div>
        </dl>

        {errorMessage ? <InlineAlert tone="error">{errorMessage}</InlineAlert> : null}
        {isSubmitting && isSlow ? (
          <p className="dialog-hint" role="status">
            Ça prend plus de temps que prévu, patientez encore un instant…
          </p>
        ) : null}

        <DialogFooter>
          <Button variant="secondary" disabled={isSubmitting} onClick={onBack}>
            Changer de client
          </Button>
          <Button
            ref={confirmRef}
            type="submit"
            variant="primary"
            loading={isSubmitting}
            loadingLabel="Enregistrement…"
          >
            Valider la vente
          </Button>
        </DialogFooter>
      </DialogForm>
    </Dialog>
  )
}
