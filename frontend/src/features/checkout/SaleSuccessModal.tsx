import { useEffect, useRef, useState } from "react"

import { Button, buttonClassName } from "../../components/ui/Button"
import { Money } from "../../components/ui/Money"
import { useDialogFocusTrap } from "../../components/ui/useDialogFocusTrap"
import { CancelSaleDialog } from "../sales/CancelSaleDialog"
import type { CancelSaleInput } from "../sales/cancelSale"
import { withSaleOrigin } from "../sales/origin"
import { describeSettlement, PAYMENT_LABELS } from "../sales/paymentLabels"
import type { ReceiptView } from "../sales/receiptView"

type SaleSuccessModalProps = {
  sale: ReceiptView
  cashSessionId?: string
  onNewSale: () => void
  onPrintTicket?: () => void
  /** Rejette en cas d'échec : le dialogue d'annulation reste ouvert. */
  onCancelSale: (input: CancelSaleInput) => Promise<unknown>
}

/**
 * Écran de succès de vente. Même grammaire que les autres succès du
 * produit : marque de statut → titre → résultat clé → action primaire →
 * action secondaire. Ici le résultat clé est la monnaie à rendre.
 */
export function SaleSuccessModal({
  sale,
  cashSessionId,
  onNewSale,
  onPrintTicket,
  onCancelSale,
}: SaleSuccessModalProps) {
  const dialogRef = useRef<HTMLElement>(null)
  const newSaleButtonRef = useRef<HTMLButtonElement>(null)
  useDialogFocusTrap(dialogRef)
  const [isConfirmingCancel, setIsConfirmingCancel] = useState(false)
  const isSplitPayment = sale.payments.length > 1
  const hasCredit = sale.creditAmount > 0
  // Avec une part au cahier, un paiement unique ne couvre plus le total :
  // son montant doit s'afficher, comme pour un paiement mixte.
  const showLegAmounts = isSplitPayment || hasCredit
  const changePayments = sale.payments.filter((payment) => payment.changeAmount !== null)
  const changeTotal = changePayments.reduce((sum, payment) => sum + (payment.changeAmount ?? 0), 0)

  // L'action suivante attendue après une vente est la vente suivante : le
  // focus y va, donc Entrée l'enchaîne sans quitter le clavier.
  useEffect(() => {
    newSaleButtonRef.current?.focus()
  }, [])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.repeat) return
      // La confirmation d'annulation a son propre clavier : Entrée n'y
      // déclenche jamais "Nouvelle vente" par-dessus.
      if (isConfirmingCancel) return
      // Échap ferme comme toutes les autres modales ; fermer, ici, c'est
      // passer à la vente suivante.
      if (event.key === "Escape") {
        onNewSale()
        return
      }
      if (event.key !== "Enter") return
      // Focus sur un bouton ou un lien (Imprimer, Annuler cette vente,
      // Nouvelle vente elle-même) : l'activation native fait déjà le bon
      // geste. Intercepter ici fermait la modale avant que « Annuler cette
      // vente » ne puisse s'ouvrir au clavier.
      if (
        event.target instanceof Element &&
        event.target.closest("button, a, input, select, textarea")
      ) {
        return
      }
      onNewSale()
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [onNewSale, isConfirmingCancel])

  return (
    <div className="dialog-backdrop">
      <section
        ref={dialogRef}
        className="dialog success-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sale-success-title"
      >
        <div className="success-mark" aria-hidden="true">
          ✓
        </div>
        <p className="eyebrow">Vente terminée</p>
        <h2 id="sale-success-title">Vente validée</h2>

        {/* Ce que le caissier regarde en rendant les billets : en tête et en
            grand, pas en dernière ligne du récapitulatif. */}
        {changePayments.length > 0 ? (
          <div className="sale-change-hero">
            <span>Monnaie à rendre</span>
            <strong>
              <Money value={changeTotal} />
            </strong>
          </div>
        ) : null}

        {sale.isPendingSync ? (
          <p className="sale-pending-note">
            Vente enregistrée sur la caisse, synchronisation automatique.
            Référence locale : {sale.id.slice(0, 8).toUpperCase()}
          </p>
        ) : null}

        <dl className="sale-amounts">
          <div>
            <dt>Total</dt>
            <dd>
              <Money value={sale.total} />
            </dd>
          </div>
          {sale.payments.map((payment, index) => (
            <div key={`method-${payment.method}-${index}`}>
              <dt>{isSplitPayment ? `Paiement ${index + 1}` : "Paiement"}</dt>
              <dd>
                {PAYMENT_LABELS[payment.method]}
                {showLegAmounts ? (
                  <>
                    {" — "}
                    <Money value={payment.amount} />
                  </>
                ) : null}
              </dd>
            </div>
          ))}
          {sale.payments.map((payment, index) =>
            payment.receivedAmount !== null ? (
              <div key={`received-${index}`}>
                <dt>{isSplitPayment ? `Reçu (paiement ${index + 1})` : "Reçu"}</dt>
                <dd>
                  <Money value={payment.receivedAmount} />
                </dd>
              </div>
            ) : null,
          )}
          {hasCredit ? (
            <>
              <div className="sale-credit-amount">
                <dt>Mis au cahier</dt>
                <dd>
                  <Money value={sale.creditAmount} />
                </dd>
              </div>
              <div>
                <dt>Client</dt>
                <dd>{sale.customer?.name ?? "—"}</dd>
              </div>
            </>
          ) : null}
        </dl>

        <div className="sale-success-actions">
          {/* Navigation pleine page assumée : le ticket sort du parcours
              d'encaissement et repart d'un état propre. */}
          <a
            className={buttonClassName({ variant: "secondary" })}
            href={withSaleOrigin(
              `/sales/${encodeURIComponent(sale.id)}/receipt${cashSessionId ? `?cash_session_id=${encodeURIComponent(cashSessionId)}` : ""}`,
              "pos",
            )}
            onClick={onPrintTicket}
          >
            Imprimer le ticket
          </a>
          <Button ref={newSaleButtonRef} variant="primary" onClick={onNewSale}>
            Nouvelle vente
          </Button>
        </div>

        {/* Correction d'une erreur repérée immédiatement — délibérément en
            retrait par rapport aux deux actions attendues ci-dessus. */}
        <button
          type="button"
          className="sale-success-cancel-trigger"
          onClick={() => setIsConfirmingCancel(true)}
        >
          Erreur ? Annuler cette vente
        </button>
      </section>

      {isConfirmingCancel ? (
        <CancelSaleDialog
          eyebrow="Vente validée"
          saleId={sale.id}
          cashSessionId={cashSessionId}
          onClose={() => setIsConfirmingCancel(false)}
          onCancel={onCancelSale}
          description={
            <>
              Le stock sera remis à jour.
              {sale.payments.length > 0 ? (
                <>
                  {" "}Si le client a déjà payé ({describeSettlement(sale.payments, 0)}),
                  cette action ne touche pas le paiement — c'est à vous de le
                  rembourser si besoin.
                </>
              ) : null}
              {hasCredit ? (
                <>
                  {" "}La somme mise au cahier de {sale.customer?.name ?? "ce client"} sera
                  retirée de son solde.
                </>
              ) : null}
            </>
          }
        />
      ) : null}
    </div>
  )
}
