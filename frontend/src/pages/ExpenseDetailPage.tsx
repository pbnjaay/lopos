import { type FormEvent, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useParams } from "react-router-dom"

import { ApiError } from "../api/client"
import { cancelExpense, getExpense } from "../api/expenses"
import { PageHeader } from "../components/layout/PageHeader"
import { Button } from "../components/ui/Button"
import { Dialog, DialogFooter, DialogForm } from "../components/ui/Dialog"
import { XIcon } from "../components/ui/Icons"
import { InlineAlert } from "../components/ui/InlineAlert"
import { MetaList } from "../components/ui/Metadata"
import { Money } from "../components/ui/Money"
import { RouteError, RouteLoading } from "../components/ui/RouteState"
import { useToast } from "../components/ui/Toast"
import { useNetworkStatus } from "../features/offline/useNetworkStatus"
import { PAYMENT_LABELS } from "../features/sales/paymentLabels"
import type { Expense } from "../types/api"
import { formatDateTime } from "../utils/date"
import { describeErrorShort } from "../utils/errorCopy"
import { formatBackendMoney } from "../utils/money"

export function expenseDetailQueryKey(expenseId: string | undefined) {
  return ["expenses", "detail", expenseId] as const
}

type CancelExpenseDialogProps = {
  expense: Expense
  onClose: () => void
  onCancelled: (expense: Expense) => void
}

/**
 * Annuler, jamais modifier ni supprimer : la dépense reste visible, barrée,
 * avec qui, quand et pourquoi. Le motif est obligatoire.
 */
function CancelExpenseDialog({ expense, onClose, onCancelled }: CancelExpenseDialogProps) {
  const reasonRef = useRef<HTMLTextAreaElement>(null)
  const [reason, setReason] = useState("")
  const [validationError, setValidationError] = useState<string | null>(null)
  const cancelMutation = useMutation({
    mutationFn: () => cancelExpense(expense.id, reason.trim()),
    onSuccess: onCancelled,
  })
  const isPending = cancelMutation.isPending
  // Un refus définitif (déjà annulée, session clôturée) ne se corrige pas en
  // réessayant : seule la fermeture reste proposée.
  const isFinalRefusal =
    cancelMutation.error instanceof ApiError &&
    (cancelMutation.error.code === "EXPENSE_ALREADY_CANCELLED" ||
      cancelMutation.error.code === "EXPENSE_NOT_CANCELLABLE")

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isPending) return
    if (!reason.trim()) {
      setValidationError("Indiquez pourquoi cette dépense est annulée.")
      reasonRef.current?.focus()
      return
    }
    setValidationError(null)
    cancelMutation.mutate()
  }

  return (
    <Dialog
      eyebrow="Dépense"
      title="Annuler cette dépense ?"
      size="sm"
      initialFocusRef={reasonRef}
      dismissible={!isPending}
      onClose={onClose}
    >
      <DialogForm onSubmit={handleSubmit}>
        <p>
          {formatBackendMoney(expense.amount)} · {expense.category.name} ·{" "}
          {PAYMENT_LABELS[expense.payment_method]}.{" "}
          {expense.payment_method === "CASH"
            ? "Le montant revient dans les espèces attendues de la caisse."
            : "Les espèces attendues ne changent pas."}{" "}
          Pour corriger un montant, annulez puis saisissez la bonne dépense.
        </p>
        <div className="field">
          <label htmlFor="expense-cancel-reason">Motif</label>
          <textarea
            ref={reasonRef}
            id="expense-cancel-reason"
            rows={2}
            maxLength={500}
            placeholder="Ex. Saisie en double"
            value={reason}
            disabled={isPending}
            aria-required
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
        {validationError ? <InlineAlert tone="error">{validationError}</InlineAlert> : null}
        {cancelMutation.error ? (
          <InlineAlert tone="error">{describeErrorShort(cancelMutation.error, "depense")}</InlineAlert>
        ) : null}
        <DialogFooter>
          <Button variant="secondary" disabled={isPending} onClick={onClose}>
            Garder la dépense
          </Button>
          {!isFinalRefusal ? (
            <Button type="submit" variant="destructive" loading={isPending} loadingLabel="Annulation…">
              Annuler la dépense
            </Button>
          ) : null}
        </DialogFooter>
      </DialogForm>
    </Dialog>
  )
}

/** Fiche d'une dépense, sur le modèle de la fiche vente. */
export function ExpenseDetailPage() {
  const { expenseId } = useParams<{ expenseId: string }>()
  const online = useNetworkStatus()
  const queryClient = useQueryClient()
  const toast = useToast()
  const [isCancelling, setIsCancelling] = useState(false)

  const expenseQuery = useQuery({
    queryKey: expenseDetailQueryKey(expenseId),
    queryFn: () => getExpense(expenseId!),
    enabled: Boolean(expenseId && online),
    retry: false,
  })

  if (!online) {
    return (
      <RouteError
        context="depense"
        title="Mode hors ligne"
        description="Les dépenses redeviendront consultables dès le retour de la connexion. Vous pouvez continuer à vendre."
      />
    )
  }
  if (expenseQuery.isLoading) return <RouteLoading message="Chargement de la dépense…" />
  if (expenseQuery.error || !expenseQuery.data) {
    return (
      <RouteError error={expenseQuery.error} context="depense" onRetry={() => void expenseQuery.refetch()} />
    )
  }

  const expense = expenseQuery.data
  const cancelled = expense.status === "CANCELLED"
  const place = expense.cash_register
    ? `${expense.store.name} · ${expense.cash_register.name}`
    : expense.store.name

  return (
    <main className="operational-page">
      <PageHeader
        backTo="/expenses"
        backLabel="Retour aux dépenses"
        eyebrow="Dépense"
        title={expense.category.name}
        context={`${place} · ${expense.reference}`}
        actions={
          expense.can_cancel ? (
            <Button variant="secondary" size="sm" onClick={() => setIsCancelling(true)}>
              <XIcon />
              <span>Annuler la dépense</span>
            </Button>
          ) : null
        }
      />

      <section className="operational-card sale-detail-card">
        <MetaList
          label="Informations de la dépense"
          items={[
            { label: "Date et heure", value: formatDateTime(expense.occurred_at) },
            { label: "Saisie par", value: expense.created_by },
            { label: "Mode de paiement", value: PAYMENT_LABELS[expense.payment_method] },
            ...(expense.description ? [{ label: "Description", value: expense.description }] : []),
            ...(expense.document_reference
              ? [{ label: "Référence", value: expense.document_reference }]
              : []),
            { label: "Statut", value: cancelled ? "Annulée" : "Enregistrée" },
          ]}
        />

        <div className="sale-detail-summary">
          <p className="eyebrow">Récapitulatif</p>
          <dl className="sale-detail-totals" aria-label="Montant de la dépense">
            <div className="sale-detail-net">
              <dt>Montant</dt>
              <dd className={cancelled ? "expense-amount-cancelled" : undefined}>
                <Money backend={expense.amount} />
              </dd>
            </div>
          </dl>
        </div>

        {cancelled ? (
          <InlineAlert tone="warning" className="sale-detail-note" title="Dépense annulée">
            {expense.cancelled_at ? `Le ${formatDateTime(expense.cancelled_at)}` : "Annulée"}
            {expense.cancelled_by ? ` par ${expense.cancelled_by}` : ""} : {expense.cancellation_reason}. Elle ne
            compte plus dans les totaux ni dans les espèces attendues.
          </InlineAlert>
        ) : expense.payment_method === "CASH" ? (
          <InlineAlert className="sale-detail-note">
            Payée en espèces : ce montant est sorti du tiroir et déduit des espèces attendues.
          </InlineAlert>
        ) : null}
      </section>

      {isCancelling ? (
        <CancelExpenseDialog
          expense={expense}
          onClose={() => setIsCancelling(false)}
          onCancelled={(updated) => {
            queryClient.setQueryData(expenseDetailQueryKey(expense.id), updated)
            void queryClient.invalidateQueries({ queryKey: ["expenses"] })
            void queryClient.invalidateQueries({ queryKey: ["cash-sessions"] })
            setIsCancelling(false)
            toast.success("Dépense annulée", {
              description: `${formatBackendMoney(updated.amount)} · ${updated.category.name}`,
            })
          }}
        />
      ) : null}
    </main>
  )
}
