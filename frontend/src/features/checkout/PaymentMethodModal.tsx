import { useEffect, useRef } from "react"

import { Dialog } from "../../components/ui/Dialog"
import { Money } from "../../components/ui/Money"
import type { PaymentMethod } from "../../types/api"

type PaymentMethodModalProps = {
  total: number
  lastUsedMethod?: PaymentMethod | null
  onClose: () => void
  onSelect: (method: PaymentMethod) => void
}

const methods: Array<{
  method: PaymentMethod
  shortcut: "F1" | "F2" | "F3"
  label: string
  description: string
}> = [
  {
    method: "CASH",
    shortcut: "F1",
    label: "Espèces",
    description: "Saisir le montant reçu et calculer la monnaie",
  },
  {
    method: "WAVE",
    shortcut: "F2",
    label: "Wave",
    description: "Confirmer manuellement la réception du paiement",
  },
  {
    method: "ORANGE_MONEY",
    shortcut: "F3",
    label: "Orange Money",
    description: "Confirmer manuellement la réception du paiement",
  },
]

// F1/F2/F3 rather than 1/2/3: digits must stay free for the cash amount
// keypad once the CASH screen is open, so the payment-method shortcuts
// can't live on the number row.
const shortcutToMethod: Record<string, PaymentMethod> = {
  F1: "CASH",
  F2: "WAVE",
  F3: "ORANGE_MONEY",
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
      if (event.repeat) return
      const method = shortcutToMethod[event.key]
      if (!method) return
      // Suppress the browser's own F1 (help) / F3 (find) behaviour.
      event.preventDefault()
      onSelect(method)
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [onSelect])

  return (
    <Dialog eyebrow="Encaissement" title="Mode de paiement" onClose={onClose}>
      <div className="dialog-body">
        <div className="payment-total">
          <span>Total à payer</span>
          <strong>
            <Money value={total} />
          </strong>
        </div>
        <div className="payment-method-list">
          {methods.map(({ method, shortcut, label, description }) => (
            <button
              key={method}
              ref={method === lastUsedMethod ? lastUsedButtonRef : undefined}
              className={`payment-method-card${
                method === lastUsedMethod ? " payment-method-card-last-used" : ""
              }`}
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
                    <span className="badge badge-neutral">Dernier utilisé</span>
                  ) : null}
                </strong>
                <small>{description}</small>
              </span>
              <span className="payment-method-arrow" aria-hidden="true">
                →
              </span>
            </button>
          ))}
        </div>
      </div>
    </Dialog>
  )
}
