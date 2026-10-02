import { type FormEvent, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"

import { Button } from "../../components/ui/Button"
import { Dialog, DialogFooter } from "../../components/ui/Dialog"
import { InlineAlert } from "../../components/ui/InlineAlert"
import { Money } from "../../components/ui/Money"
import { formatMoney, formatMoneyInput, parseMoneyInput } from "../../utils/money"
import { getSuggestedCashAmounts } from "./cashSuggestions"
import { useSlowSubmitHint } from "./useSlowSubmitHint"

/**
 * Poste tactile : même critère que la feuille de style, qui n'affiche le
 * pavé qu'ici. Pas de pointeur fin ou pas de survol — une tablette peut se
 * déclarer « fine » et n'avoir aucun survol.
 */
const TOUCH_KEYPAD_QUERY = "(pointer: coarse), (hover: none)"

function subscribeTouchKeypad(onChange: () => void) {
  const query = window.matchMedia?.(TOUCH_KEYPAD_QUERY)
  query?.addEventListener("change", onChange)
  return () => query?.removeEventListener("change", onChange)
}

function hasTouchKeypad() {
  return window.matchMedia?.(TOUCH_KEYPAD_QUERY).matches ?? false
}

type CashPaymentModalProps = {
  /** Montant à couvrir maintenant — le total, ou le reste dû après un premier versement. */
  total: number
  /** true dès qu'un versement a déjà été appliqué (paiement mixte en cours). */
  isPartial?: boolean
  onClose: () => void
  onConfirm: (receivedAmount: number) => void | Promise<void>
  /**
   * Le client ne paie pas tout : ce qui est reçu (0 si rien) est encaissé et
   * le reste part au cahier. Proposé seulement quand il reste quelque chose.
   */
  onCredit?: (receivedAmount: number) => void
  isSubmitting?: boolean
  errorMessage?: string | null
  onBack?: () => void
}

export function CashPaymentModal({
  total,
  isPartial = false,
  onClose,
  onConfirm,
  onCredit,
  isSubmitting = false,
  errorMessage = null,
  onBack,
}: CashPaymentModalProps) {
  const submissionLock = useRef(false)
  const receivedInputRef = useRef<HTMLInputElement>(null)
  const isSlow = useSlowSubmitHint(isSubmitting)
  const touchKeypad = useSyncExternalStore(subscribeTouchKeypad, hasTouchKeypad, () => false)
  const [receivedInput, setReceivedInput] = useState("")
  const receivedAmount = parseMoneyInput(receivedInput) ?? 0
  // Un montant positif mais insuffisant n'est pas bloquant : c'est un
  // versement valide pour un paiement mixte, à compléter par un autre moyen.
  const canSubmit = receivedAmount > 0
  const missingAmount = Math.max(total - receivedAmount, 0)
  const changeAmount = Math.max(receivedAmount - total, 0)
  // Un seul état financier à la fois : ce qui manque, ou ce qu'on rend.
  const status = missingAmount > 0 ? "due" : changeAmount > 0 ? "change" : "exact"
  const quickAmounts = useMemo(() => getSuggestedCashAmounts(total), [total])

  // Une erreur (stock, session fermée…) laisse le caissier corriger le
  // montant ou réessayer : il retrouve le champ, prêt à être retapé.
  useEffect(() => {
    if (errorMessage) refocusReceivedInput({ select: true })
  }, [errorMessage])

  // Keep focus on the amount field after every keypad/quick-amount tap, so
  // a physical Enter always submits the form instead of re-activating
  // whichever on-screen button last had focus.
  function refocusReceivedInput({ select = false } = {}) {
    const input = receivedInputRef.current
    input?.focus()
    if (select) input?.select()
  }

  function handleInput(value: string) {
    if (/^[\d\s]*$/.test(value)) setReceivedInput(formatMoneyInput(value))
  }

  function handleKeypadDigit(digit: string) {
    setReceivedInput((current) => formatMoneyInput(current + digit))
    refocusReceivedInput()
  }

  function handleKeypadBackspace() {
    setReceivedInput((current) => formatMoneyInput(current.replace(/\D/g, "").slice(0, -1)))
    refocusReceivedInput()
  }

  function handleKeypadClear() {
    setReceivedInput("")
    refocusReceivedInput()
  }

  // Le montant choisi reste sélectionné : Enter valide, et une frappe le
  // remplace si le client tend finalement un autre billet.
  function handleQuickAmount(amount: number) {
    setReceivedInput(formatMoneyInput(String(amount)))
    refocusReceivedInput()
    // Sélection après le rendu : poser la nouvelle valeur la désélectionne.
    window.requestAnimationFrame(() => refocusReceivedInput({ select: true }))
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submissionLock.current || isSubmitting || !canSubmit) return

    submissionLock.current = true
    try {
      await onConfirm(receivedAmount)
    } catch {
      // The parent mutation exposes the backend error through errorMessage.
    } finally {
      submissionLock.current = false
    }
  }

  const submitLabel =
    status === "due" && canSubmit
      ? "Continuer avec un autre moyen"
      : status === "change"
        ? `Valider et rendre ${formatMoney(changeAmount)}`
        : "Valider le paiement"

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
      className="cash-payment-dialog"
    >
      <form className="dialog-body cash-payment-form" onSubmit={handleSubmit}>
        <div className="payment-total cash-payment-total">
          <span>{isPartial ? "Reste à encaisser" : "Total à payer"}</span>
          <strong>
            <Money value={total} />
          </strong>
        </div>

        <div className="field cash-payment-field">
          <label htmlFor="received-amount">Montant reçu</label>
          <div className="money-input payment-money-input">
            <input
              ref={receivedInputRef}
              id="received-amount"
              autoFocus
              autoComplete="off"
              // Sur poste tactile, le pavé ci-dessous remplace le clavier du
              // système, qui recouvrirait la moitié de l'écran de paiement.
              inputMode={touchKeypad ? "none" : "numeric"}
              placeholder="0"
              value={receivedInput}
              disabled={isSubmitting}
              onChange={(event) => handleInput(event.target.value)}
            />
            <span>FCFA</span>
          </div>
        </div>

        <div className="quick-amounts" aria-label="Montants rapides">
          <Button
            variant="secondary"
            className="quick-amount"
            disabled={isSubmitting}
            onClick={() => handleQuickAmount(total)}
          >
            Montant exact
          </Button>
          {quickAmounts.map((amount) => (
            <Button
              key={amount}
              variant="secondary"
              className="quick-amount"
              disabled={isSubmitting}
              onClick={() => handleQuickAmount(amount)}
            >
              <Money value={amount} />
            </Button>
          ))}
        </div>

        {/* Outil de saisie tactile seulement : la feuille de style ne
            l'affiche que sur un poste sans pointeur fin. Au clavier, on tape
            le montant directement dans le champ. */}
        <div className="numeric-keypad" aria-label="Pavé numérique">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => (
            <button
              key={digit}
              className="numeric-keypad-key"
              type="button"
              tabIndex={-1}
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
            tabIndex={-1}
            disabled={isSubmitting || receivedInput === ""}
            aria-label="Effacer le montant"
            onClick={handleKeypadClear}
          >
            C
          </button>
          <button
            className="numeric-keypad-key"
            type="button"
            tabIndex={-1}
            disabled={isSubmitting}
            aria-label="Chiffre 0"
            onClick={() => handleKeypadDigit("0")}
          >
            0
          </button>
          <button
            className="numeric-keypad-key numeric-keypad-backspace"
            type="button"
            tabIndex={-1}
            disabled={isSubmitting || receivedInput === ""}
            aria-label="Supprimer le dernier chiffre"
            onClick={handleKeypadBackspace}
          >
            ⌫
          </button>
        </div>

        {/* État du paiement, pas une erreur : un montant insuffisant est un
            versement partiel valide. Il suit la saisie à chaque frappe. */}
        <div className={`payment-status payment-status-${status}`} aria-live="polite">
          <span>
            {status === "due" ? "Reste à payer" : status === "change" ? "Monnaie à rendre" : "Paiement exact"}
          </span>
          <strong>
            {status === "exact" ? "Rien à rendre" : <Money value={status === "due" ? missingAmount : changeAmount} />}
          </strong>
        </div>

        {errorMessage ? <InlineAlert tone="error">{errorMessage}</InlineAlert> : null}
        {isSubmitting && isSlow ? (
          <p className="dialog-hint" role="status">
            Ça prend plus de temps que prévu, patientez encore un instant…
          </p>
        ) : null}

        <DialogFooter>
          {/* Le cahier porte sur le reste réel, jamais sur le total une fois
              qu'un versement est saisi — et disparaît quand tout est couvert. */}
          {status === "due" && onCredit ? (
            <Button
              variant="secondary"
              className="cash-payment-credit"
              disabled={isSubmitting}
              onClick={() => onCredit(receivedAmount)}
            >
              Mettre {formatMoney(missingAmount)} au cahier
            </Button>
          ) : (
            <Button variant="secondary" disabled={isSubmitting} onClick={onClose}>
              Annuler
            </Button>
          )}
          <Button
            variant="primary"
            type="submit"
            disabled={!canSubmit}
            loading={isSubmitting}
            loadingLabel="Validation…"
          >
            {submitLabel}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}
