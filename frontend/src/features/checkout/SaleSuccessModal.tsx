import { useEffect, useRef, useState } from "react"

import { Button, buttonClassName } from "../../components/ui/Button"
import { Dialog, DialogBody, DialogFooter } from "../../components/ui/Dialog"
import { InlineAlert } from "../../components/ui/InlineAlert"
import { Money } from "../../components/ui/Money"
import { useDialogFocusTrap } from "../../components/ui/useDialogFocusTrap"
import { withSaleOrigin } from "../sales/origin"
import type { ReceiptView } from "../sales/receiptView"

type SaleSuccessModalProps = {
  sale: ReceiptView
  cashSessionId?: string
  onNewSale: () => void
  onPrintTicket?: () => void
  onCancelSale: () => void | Promise<void>
  isCancelling?: boolean
  cancelErrorMessage?: string | null
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
  isCancelling = false,
  cancelErrorMessage = null,
}: SaleSuccessModalProps) {
  const dialogRef = useRef<HTMLElement>(null)
  const newSaleButtonRef = useRef<HTMLButtonElement>(null)
  const keepSaleButtonRef = useRef<HTMLButtonElement>(null)
  useDialogFocusTrap(dialogRef)
  const [isConfirmingCancel, setIsConfirmingCancel] = useState(false)
  const paymentLabel = {
    CASH: "Espèces",
    WAVE: "Wave",
    ORANGE_MONEY: "Orange Money",
  }[sale.payment.method]

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
      if (event.key === "Enter") onNewSale()
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [onNewSale, isConfirmingCancel])

  async function confirmCancelSale() {
    try {
      await onCancelSale()
      // Succès : le parent vide `completedSale`, ce composant se démonte.
      setIsConfirmingCancel(false)
    } catch {
      // Échec : la modale de confirmation reste ouverte, l'erreur y est
      // affichée via cancelErrorMessage — rien à faire ici.
    }
  }

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

        {sale.isPendingSync ? (
          <p className="sale-pending-note">
            Vente enregistrée sur la caisse, synchronisation automatique.
            Référence locale : {sale.id.slice(0, 8).toUpperCase()}
          </p>
        ) : null}

        <dl className="sale-amounts">
          <div>
            <dt>Paiement</dt>
            <dd>{paymentLabel}</dd>
          </div>
          <div>
            <dt>Total</dt>
            <dd>
              <Money value={sale.total} />
            </dd>
          </div>
          {sale.payment.receivedAmount !== null ? (
            <div>
              <dt>Reçu</dt>
              <dd>
                <Money value={sale.payment.receivedAmount} />
              </dd>
            </div>
          ) : null}
          {sale.payment.changeAmount !== null ? (
            <div className="sale-change">
              <dt>Monnaie</dt>
              <dd>
                <Money value={sale.payment.changeAmount} />
              </dd>
            </div>
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
        <Dialog
          eyebrow="Vente validée"
          title="Annuler cette vente ?"
          size="sm"
          initialFocusRef={keepSaleButtonRef}
          dismissible={!isCancelling}
          onClose={() => setIsConfirmingCancel(false)}
        >
          <DialogBody>
            <p>
              Le stock sera remis à jour. Si le client a déjà payé
              ({paymentLabel}), cette action ne touche pas le paiement —
              c'est à vous de le rembourser si besoin.
            </p>
            {cancelErrorMessage ? (
              <InlineAlert tone="error">{cancelErrorMessage}</InlineAlert>
            ) : null}
            <DialogFooter>
              <Button
                ref={keepSaleButtonRef}
                variant="secondary"
                disabled={isCancelling}
                onClick={() => setIsConfirmingCancel(false)}
              >
                Garder la vente
              </Button>
              <Button
                variant="destructive"
                loading={isCancelling}
                loadingLabel="Annulation…"
                onClick={() => void confirmCancelSale()}
              >
                Confirmer l'annulation
              </Button>
            </DialogFooter>
          </DialogBody>
        </Dialog>
      ) : null}
    </div>
  )
}
