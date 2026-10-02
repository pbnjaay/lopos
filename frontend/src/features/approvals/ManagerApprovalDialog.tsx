import { useQuery } from "@tanstack/react-query"
import { type FormEvent, useRef, useState } from "react"

import { ApiError } from "../../api/client"
import { listApprovers, requestApproval } from "../../api/approvals"
import { Button } from "../../components/ui/Button"
import { Dialog, DialogFooter } from "../../components/ui/Dialog"
import { InlineAlert } from "../../components/ui/InlineAlert"
import type { ApprovalAction } from "../../types/api"
import { describeErrorShort } from "../../utils/errorCopy"

type ManagerApprovalDialogProps = {
  cashSessionId: string
  action: ApprovalAction
  /** Vente concernée ; pour une remise, l'identifiant réservé à la vente. */
  saleId: string
  /** Ce que le gérant valide, en une phrase. */
  summary: string
  onApproved: (approvalToken: string) => void
  onClose: () => void
}

/**
 * Le gérant (ou le propriétaire) choisit son nom et tape son code PIN sur
 * le poste du caissier. Le PIN part au serveur, qui rend une validation
 * limitée à cette opération : rien n'est gardé sur le poste.
 */
export function ManagerApprovalDialog({
  cashSessionId,
  action,
  saleId,
  summary,
  onApproved,
  onClose,
}: ManagerApprovalDialogProps) {
  const pinRef = useRef<HTMLInputElement>(null)
  const [approverId, setApproverId] = useState("")
  const [pin, setPin] = useState("")
  const [error, setError] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const approversQuery = useQuery({
    queryKey: ["approvers", cashSessionId],
    queryFn: () => listApprovers(cashSessionId),
    staleTime: 60_000,
  })
  const approvers = approversQuery.data ?? []
  const selectedApproverId = approverId || (approvers.length === 1 && approvers[0] ? String(approvers[0].id) : "")

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedApproverId || !/^\d{4,6}$/.test(pin)) {
      setError("Choisissez le gérant et saisissez son code PIN (4 à 6 chiffres).")
      return
    }
    setIsSubmitting(true)
    setError("")
    try {
      const result = await requestApproval({
        cashSessionId,
        action,
        saleId,
        approverId: Number(selectedApproverId),
        pin,
      })
      onApproved(result.approval_token)
    } catch (submitError) {
      setPin("")
      setError(
        submitError instanceof ApiError && submitError.code === "INVALID_APPROVAL_PIN"
          ? "Code PIN incorrect."
          : describeErrorShort(submitError, "vente"),
      )
      pinRef.current?.focus()
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog
      eyebrow="Validation gérant"
      title="Un gérant doit valider"
      size="sm"
      dismissible={!isSubmitting}
      onClose={onClose}
      initialFocusRef={pinRef}
    >
      <form className="dialog-body" onSubmit={(event) => void handleSubmit(event)}>
        <p>{summary}</p>
        {approversQuery.isError ? (
          <InlineAlert tone="error">{describeErrorShort(approversQuery.error, "vente")}</InlineAlert>
        ) : approversQuery.isSuccess && approvers.length === 0 ? (
          <InlineAlert tone="warning">
            Aucun gérant de ce magasin n’a encore choisi de code PIN (back-office › Mon code PIN).
          </InlineAlert>
        ) : null}
        <label className="field">
          <span className="field-label">Gérant</span>
          <select
            value={selectedApproverId}
            disabled={isSubmitting || approvers.length === 0}
            onChange={(event) => setApproverId(event.target.value)}
          >
            <option value="">Sélectionner</option>
            {approvers.map((approver) => (
              <option key={approver.id} value={approver.id}>{approver.name}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Code PIN du gérant</span>
          <input
            ref={pinRef}
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={6}
            value={pin}
            disabled={isSubmitting}
            aria-invalid={Boolean(error)}
            onChange={(event) => {
              setPin(event.target.value.replace(/\D/g, ""))
              setError("")
            }}
          />
        </label>
        {error ? (
          <p className="field-error" role="alert">{error}</p>
        ) : null}
        <DialogFooter>
          <Button variant="secondary" disabled={isSubmitting} onClick={onClose}>Annuler</Button>
          <Button variant="primary" type="submit" loading={isSubmitting} loadingLabel="Vérification…">
            Valider
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}
