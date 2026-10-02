import { type FormEvent, type ReactNode, useRef, useState } from "react"

import { Button } from "../../components/ui/Button"
import { Dialog, DialogFooter } from "../../components/ui/Dialog"
import { InlineAlert } from "../../components/ui/InlineAlert"
import { describeErrorShort } from "../../utils/errorCopy"
import { ManagerApprovalDialog } from "../approvals/ManagerApprovalDialog"
import { isApprovalRequiredError } from "../approvals/policy"
import type { CancelSaleInput } from "./cancelSale"

type CancelSaleDialogProps = {
  eyebrow: string
  saleId: string
  /** Session ouverte du poste : la validation d'un gérant y est liée. */
  cashSessionId?: string
  /** Conséquences de l'annulation (stock, paiement, cahier). */
  description: ReactNode
  onCancel: (input: CancelSaleInput) => Promise<unknown>
  onClose: () => void
}

/**
 * Confirmation d'une annulation : motif obligatoire, puis — si le serveur
 * l'exige (montant au-delà du seuil) — validation par le PIN d'un gérant,
 * et nouvelle tentative avec cette validation.
 */
export function CancelSaleDialog({
  eyebrow,
  saleId,
  cashSessionId,
  description,
  onCancel,
  onClose,
}: CancelSaleDialogProps) {
  const reasonRef = useRef<HTMLTextAreaElement>(null)
  const [reason, setReason] = useState("")
  const [error, setError] = useState<unknown>(null)
  const [isPending, setIsPending] = useState(false)
  const [needsApproval, setNeedsApproval] = useState(false)
  const trimmedReason = reason.trim()

  async function submit(approvalToken?: string) {
    if (!trimmedReason) return
    setIsPending(true)
    setError(null)
    try {
      await onCancel({ reason: trimmedReason, approvalToken: approvalToken ?? null })
      // Succès : le parent ferme ou démonte ce dialogue.
    } catch (cancelError) {
      if (!approvalToken && isApprovalRequiredError(cancelError) && cashSessionId) {
        setNeedsApproval(true)
      } else {
        setError(cancelError)
      }
    } finally {
      setIsPending(false)
    }
  }

  if (needsApproval && cashSessionId) {
    return (
      <ManagerApprovalDialog
        cashSessionId={cashSessionId}
        action="CANCEL_SALE"
        saleId={saleId}
        summary={`Annulation de vente. Motif : « ${trimmedReason} ».`}
        onApproved={(token) => {
          setNeedsApproval(false)
          void submit(token)
        }}
        onClose={() => setNeedsApproval(false)}
      />
    )
  }

  return (
    <Dialog
      eyebrow={eyebrow}
      title="Annuler cette vente ?"
      size="sm"
      initialFocusRef={reasonRef}
      dismissible={!isPending}
      onClose={onClose}
    >
      <form
        className="dialog-body"
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault()
          void submit()
        }}
      >
        <p>{description}</p>
        <div className="field">
          <label htmlFor="cancel-sale-reason">Motif (obligatoire)</label>
          <textarea
            ref={reasonRef}
            id="cancel-sale-reason"
            rows={2}
            maxLength={500}
            placeholder="Ex. Mauvais article scanné"
            value={reason}
            disabled={isPending}
            aria-required
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
        {error ? <InlineAlert tone="error">{describeErrorShort(error, "vente")}</InlineAlert> : null}
        <DialogFooter>
          <Button variant="secondary" disabled={isPending} onClick={onClose}>
            Garder la vente
          </Button>
          <Button
            variant="destructive"
            type="submit"
            disabled={!trimmedReason}
            loading={isPending}
            loadingLabel="Annulation…"
          >
            Confirmer l'annulation
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}
