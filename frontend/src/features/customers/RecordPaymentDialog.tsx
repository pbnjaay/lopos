import { type FormEvent, useRef, useState } from "react"
import { useMutation } from "@tanstack/react-query"

import { ApiError } from "../../api/client"
import { Button, buttonClassName } from "../../components/ui/Button"
import { Dialog, DialogFooter, DialogForm } from "../../components/ui/Dialog"
import { InlineAlert } from "../../components/ui/InlineAlert"
import { Money } from "../../components/ui/Money"
import { SegmentedControl } from "../../components/ui/SegmentedControl"
import type { CustomerPayment, PaymentMethod } from "../../types/api"
import { describeErrorShort } from "../../utils/errorCopy"
import { formatMoneyInput, parseMoneyInput } from "../../utils/money"
import { useSlowSubmitHint } from "../checkout/useSlowSubmitHint"
import { type CustomerSummary, recordCustomerPayment } from "./customerService"

const METHOD_OPTIONS: ReadonlyArray<{ value: PaymentMethod; label: string }> = [
  { value: "CASH", label: "Espèces" },
  { value: "WAVE", label: "Wave" },
  { value: "ORANGE_MONEY", label: "Orange Money" },
]

type RecordPaymentDialogProps = {
  customer: CustomerSummary
  storeId: string
  cashSessionId: string
  onClose: () => void
  /** Appelé une fois le paiement confirmé par le serveur. */
  onRecorded?: (payment: CustomerPayment) => void
}

/**
 * Le client revient payer : moyen, montant (jamais plus que ce qu'il doit),
 * montant reçu pour les espèces. En ligne uniquement — le solde fait foi
 * côté serveur, et deux caisses ne doivent pas encaisser la même dette.
 */
export function RecordPaymentDialog({
  customer,
  storeId,
  cashSessionId,
  onClose,
  onRecorded,
}: RecordPaymentDialogProps) {
  const amountRef = useRef<HTMLInputElement>(null)
  // Une clé par tentative : un renvoi après coupure retrouve le même
  // paiement ; seul un refus définitif du serveur en ouvre une nouvelle.
  const idempotencyKey = useRef(crypto.randomUUID())
  const [method, setMethod] = useState<PaymentMethod>("CASH")
  const [amountInput, setAmountInput] = useState(formatMoneyInput(String(customer.balance)))
  const [receivedInput, setReceivedInput] = useState("")
  const [validationError, setValidationError] = useState<string | null>(null)

  const amount = parseMoneyInput(amountInput)
  const received = receivedInput.trim() === "" ? amount : parseMoneyInput(receivedInput)
  const change = method === "CASH" && amount !== null && received !== null ? received - amount : 0

  const paymentMutation = useMutation({
    mutationFn: recordCustomerPayment,
    onSuccess: (payment) => onRecorded?.(payment),
    onError: (error) => {
      if (error instanceof ApiError && error.status < 500) {
        idempotencyKey.current = crypto.randomUUID()
      }
    },
  })
  const isSlow = useSlowSubmitHint(paymentMutation.isPending)
  const payment = paymentMutation.data ?? null

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (paymentMutation.isPending) return
    if (amount === null || amount <= 0) {
      setValidationError("Saisissez le montant payé par le client.")
      amountRef.current?.focus()
      return
    }
    if (amount > customer.balance) {
      setValidationError("Le montant dépasse ce que le client doit.")
      amountRef.current?.focus()
      return
    }
    if (method === "CASH" && (received === null || received < amount)) {
      setValidationError("Le montant reçu est inférieur au montant payé.")
      return
    }
    setValidationError(null)
    paymentMutation.mutate({
      storeId,
      idempotencyKey: idempotencyKey.current,
      customerId: customer.id,
      cashSessionId,
      method,
      amount,
      receivedAmount: method === "CASH" ? received : null,
    })
  }

  if (payment) {
    const changeAmount = Math.round(Number(payment.change_amount ?? 0))
    return (
      <Dialog eyebrow="Cahier client" title="Paiement enregistré" onClose={onClose}>
        <div className="dialog-body">
          {changeAmount > 0 ? (
            <div className="sale-change-hero">
              <span>Monnaie à rendre</span>
              <strong>
                <Money value={changeAmount} />
              </strong>
            </div>
          ) : null}
          <dl className="sale-amounts">
            <div>
              <dt>Payé</dt>
              <dd>
                <Money backend={payment.amount} />
              </dd>
            </div>
            <div>
              <dt>Ancien solde</dt>
              <dd>
                <Money backend={payment.balance_before} />
              </dd>
            </div>
            <div>
              <dt>Nouveau solde</dt>
              <dd>
                <strong>
                  <Money backend={payment.balance_after} />
                </strong>
              </dd>
            </div>
          </dl>
          <DialogFooter>
            <a
              className={buttonClassName({ variant: "secondary" })}
              href={`/customer-payments/${encodeURIComponent(payment.id)}/receipt?cash_session_id=${encodeURIComponent(cashSessionId)}`}
            >
              Imprimer le reçu
            </a>
            <Button variant="primary" autoFocus onClick={onClose}>
              Terminer
            </Button>
          </DialogFooter>
        </div>
      </Dialog>
    )
  }

  return (
    <Dialog
      eyebrow={customer.name}
      title="Enregistrer un paiement"
      onClose={() => {
        if (!paymentMutation.isPending) onClose()
      }}
      initialFocusRef={amountRef}
    >
      <DialogForm onSubmit={handleSubmit}>
        <div className="payment-total">
          <span>Solde dû</span>
          <strong>
            <Money value={customer.balance} />
          </strong>
        </div>

        <div className="field">
          <span className="field-label">
            Mode de paiement
          </span>
          <SegmentedControl
            label="Mode de paiement"
            options={METHOD_OPTIONS}
            value={method}
            onChange={setMethod}
            disabled={paymentMutation.isPending}
          />
        </div>

        <div className="field">
          <label htmlFor="repayment-amount">Montant payé</label>
          <div className="money-input">
            <input
              ref={amountRef}
              id="repayment-amount"
              inputMode="numeric"
              value={amountInput}
              disabled={paymentMutation.isPending}
              onChange={(event) => {
                if (/^[\d\s]*$/.test(event.target.value)) setAmountInput(formatMoneyInput(event.target.value))
              }}
            />
            <span>FCFA</span>
          </div>
        </div>

        {method === "CASH" ? (
          <div className="field">
            <label htmlFor="repayment-received">Montant reçu</label>
            <div className="money-input">
              <input
                id="repayment-received"
                inputMode="numeric"
                placeholder={amountInput || "0"}
                value={receivedInput}
                disabled={paymentMutation.isPending}
                onChange={(event) => {
                  if (/^[\d\s]*$/.test(event.target.value)) setReceivedInput(formatMoneyInput(event.target.value))
                }}
              />
              <span>FCFA</span>
            </div>
            {change > 0 ? (
              <small className="field-help">
                Monnaie à rendre : <Money value={change} />
              </small>
            ) : null}
          </div>
        ) : null}

        {amount !== null && amount > 0 && amount <= customer.balance ? (
          <p className="repayment-new-balance">
            Nouveau solde : <strong><Money value={customer.balance - amount} /></strong>
          </p>
        ) : null}

        {validationError ? <InlineAlert tone="error">{validationError}</InlineAlert> : null}
        {paymentMutation.error ? (
          <InlineAlert tone="error">{describeErrorShort(paymentMutation.error, "client")}</InlineAlert>
        ) : null}
        {paymentMutation.isPending && isSlow ? (
          <p className="dialog-hint" role="status">
            Ça prend plus de temps que prévu, patientez encore un instant…
          </p>
        ) : null}

        <DialogFooter>
          <Button variant="secondary" disabled={paymentMutation.isPending} onClick={onClose}>
            Annuler
          </Button>
          <Button
            type="submit"
            variant="primary"
            loading={paymentMutation.isPending}
            loadingLabel="Enregistrement…"
          >
            Enregistrer le paiement
          </Button>
        </DialogFooter>
      </DialogForm>
    </Dialog>
  )
}
