import { type FormEvent, useRef, useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"

import { ApiError } from "../../api/client"
import { createExpense, listExpenseCategories } from "../../api/expenses"
import { Button } from "../../components/ui/Button"
import { Dialog, DialogFooter, DialogForm } from "../../components/ui/Dialog"
import { InlineAlert } from "../../components/ui/InlineAlert"
import { SegmentedControl } from "../../components/ui/SegmentedControl"
import { SkeletonRows } from "../../components/ui/Skeleton"
import type { Expense, PaymentMethod } from "../../types/api"
import { describeErrorShort } from "../../utils/errorCopy"
import { formatMoneyInput, parseMoneyInput, toBackendMoney } from "../../utils/money"
import { useSlowSubmitHint } from "../checkout/useSlowSubmitHint"
import { useNetworkStatus } from "../offline/useNetworkStatus"

const METHOD_OPTIONS: ReadonlyArray<{ value: PaymentMethod; label: string }> = [
  { value: "CASH", label: "Espèces" },
  { value: "WAVE", label: "Wave" },
  { value: "ORANGE_MONEY", label: "Orange Money" },
]

export const expenseCategoriesQueryKey = ["expense-categories"] as const

type NewExpenseDialogProps = {
  cashSessionId: string
  onClose: () => void
  /** Appelé une fois la dépense confirmée par le serveur. */
  onRecorded: (expense: Expense) => void
}

/**
 * « J'ai payé 15 000 FCFA d'électricité » : montant, catégorie, mode,
 * description — une seule fenêtre. En ligne uniquement : le serveur vérifie
 * la session et les espèces disponibles dans le tiroir.
 *
 * Aucune catégorie n'est présélectionnée : une dépense rangée d'office dans
 * la première catégorie venue fausserait les totaux sans que personne ne le
 * voie.
 */
export function NewExpenseDialog({ cashSessionId, onClose, onRecorded }: NewExpenseDialogProps) {
  const online = useNetworkStatus()
  const amountRef = useRef<HTMLInputElement>(null)
  const descriptionRef = useRef<HTMLTextAreaElement>(null)
  // Une clé par tentative : un renvoi après coupure retrouve la même
  // dépense ; seul un refus définitif du serveur en ouvre une nouvelle.
  const idempotencyKey = useRef(crypto.randomUUID())
  const [amountInput, setAmountInput] = useState("")
  const [categoryId, setCategoryId] = useState("")
  const [method, setMethod] = useState<PaymentMethod>("CASH")
  const [description, setDescription] = useState("")
  const [documentReference, setDocumentReference] = useState("")
  const [validationError, setValidationError] = useState<string | null>(null)

  const categoriesQuery = useQuery({
    queryKey: expenseCategoriesQueryKey,
    queryFn: listExpenseCategories,
    enabled: online,
    staleTime: 5 * 60_000,
    retry: false,
  })
  const categories = categoriesQuery.data ?? []
  const category = categories.find((candidate) => candidate.id === categoryId) ?? null
  const descriptionRequired = category?.requires_description ?? false

  const expenseMutation = useMutation({
    mutationFn: createExpense,
    onSuccess: (expense) => onRecorded(expense),
    onError: (error) => {
      if (error instanceof ApiError && error.status < 500) {
        idempotencyKey.current = crypto.randomUUID()
      }
    },
  })
  const isPending = expenseMutation.isPending
  const isSlow = useSlowSubmitHint(isPending)

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isPending) return
    const amount = parseMoneyInput(amountInput)
    if (amount === null || amount <= 0) {
      setValidationError("Saisissez le montant de la dépense.")
      amountRef.current?.focus()
      return
    }
    if (!category) {
      setValidationError("Choisissez une catégorie.")
      return
    }
    if (descriptionRequired && !description.trim()) {
      setValidationError(`Précisez ce qui a été payé pour « ${category.name} ».`)
      descriptionRef.current?.focus()
      return
    }
    setValidationError(null)
    expenseMutation.mutate({
      idempotencyKey: idempotencyKey.current,
      cashSessionId,
      categoryId: category.id,
      paymentMethod: method,
      amount: toBackendMoney(amount),
      description: description.trim(),
      documentReference: documentReference.trim(),
    })
  }

  return (
    <Dialog
      eyebrow="Dépenses"
      title="Nouvelle dépense"
      onClose={() => {
        if (!isPending) onClose()
      }}
      initialFocusRef={amountRef}
    >
      <DialogForm onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor="expense-amount">Montant</label>
          <div className="money-input">
            <input
              ref={amountRef}
              id="expense-amount"
              inputMode="numeric"
              autoComplete="off"
              value={amountInput}
              disabled={isPending}
              onChange={(event) => {
                if (/^[\d\s]*$/.test(event.target.value)) setAmountInput(formatMoneyInput(event.target.value))
              }}
            />
            <span>FCFA</span>
          </div>
        </div>

        <div className="field expense-category-field">
          <span className="field-label">Catégorie</span>
          {categoriesQuery.isLoading ? (
            <SkeletonRows count={2} label="Chargement des catégories…" />
          ) : categoriesQuery.error ? (
            <InlineAlert tone="error">{describeErrorShort(categoriesQuery.error, "depense")}</InlineAlert>
          ) : (
            <SegmentedControl
              label="Catégorie"
              options={categories.map((candidate) => ({ value: candidate.id, label: candidate.name }))}
              value={categoryId}
              onChange={setCategoryId}
              disabled={isPending}
            />
          )}
        </div>

        <div className="field">
          <span className="field-label">Mode de paiement</span>
          <SegmentedControl
            label="Mode de paiement"
            options={METHOD_OPTIONS}
            value={method}
            onChange={setMethod}
            disabled={isPending}
          />
          {method !== "CASH" ? (
            <small className="field-help">Payée hors du tiroir : les espèces attendues ne changent pas.</small>
          ) : null}
        </div>

        <div className="field">
          <label htmlFor="expense-description">
            Description{descriptionRequired ? " (obligatoire)" : ""}
          </label>
          <textarea
            ref={descriptionRef}
            id="expense-description"
            rows={2}
            maxLength={1000}
            placeholder={descriptionRequired ? "Ce qui a été payé" : "Ex. Facture août"}
            value={description}
            disabled={isPending}
            aria-required={descriptionRequired}
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="expense-reference">Référence</label>
          <input
            id="expense-reference"
            autoComplete="off"
            maxLength={64}
            placeholder="N° de facture ou de transaction (facultatif)"
            value={documentReference}
            disabled={isPending}
            onChange={(event) => setDocumentReference(event.target.value)}
          />
        </div>

        {!online ? (
          <InlineAlert tone="warning">
            Une dépense s’enregistre en ligne. Notez-la et saisissez-la au retour de la connexion.
          </InlineAlert>
        ) : null}
        {validationError ? <InlineAlert tone="error">{validationError}</InlineAlert> : null}
        {expenseMutation.error ? (
          <InlineAlert tone="error">{describeErrorShort(expenseMutation.error, "depense")}</InlineAlert>
        ) : null}
        {isPending && isSlow ? (
          <p className="dialog-hint" role="status">
            Ça prend plus de temps que prévu, patientez encore un instant…
          </p>
        ) : null}

        <DialogFooter>
          <Button variant="secondary" disabled={isPending} onClick={onClose}>
            Annuler
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={!online || categories.length === 0}
            loading={isPending}
            loadingLabel="Enregistrement…"
          >
            Enregistrer
          </Button>
        </DialogFooter>
      </DialogForm>
    </Dialog>
  )
}
