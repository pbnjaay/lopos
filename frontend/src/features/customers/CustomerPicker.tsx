import { type FormEvent, type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"

import { Button } from "../../components/ui/Button"
import { Dialog, DialogBody, DialogForm, DialogFooter } from "../../components/ui/Dialog"
import { EmptyState } from "../../components/ui/EmptyState"
import { InlineAlert } from "../../components/ui/InlineAlert"
import { Money } from "../../components/ui/Money"
import { Skeleton } from "../../components/ui/Skeleton"
import { useDebouncedValue } from "../../hooks/useDebouncedValue"
import { describeErrorShort } from "../../utils/errorCopy"
import { formatPhone, normalizePhone, phoneSearchDigits } from "../../utils/phone"
import {
  type CustomerSummary,
  DuplicateCustomerError,
  quickCreateCustomer,
  searchCustomers,
} from "./customerService"

type CustomerPickerProps = {
  storeId: string
  /** La création d'un client exige le réseau ; la recherche, non. */
  isOnline: boolean
  onSelect: (customer: CustomerSummary) => void
  onClose: () => void
  onBack?: () => void
  eyebrow?: string
  title?: string
  /** Contexte affiché au-dessus de la recherche (ex. le montant à mettre au cahier). */
  summary?: ReactNode
}

/**
 * Choix du client d'un cahier, sans quitter la caisse : recherche par
 * numéro ou par nom dans le cache local, et création rapide (nom +
 * téléphone) quand le client n'existe pas encore.
 */
export function CustomerPicker({
  storeId,
  isOnline,
  onSelect,
  onClose,
  onBack,
  eyebrow = "Cahier client",
  title = "Choisir le client",
  summary,
}: CustomerPickerProps) {
  const [mode, setMode] = useState<"search" | "create">("search")
  const [query, setQuery] = useState("")
  const [draft, setDraft] = useState({ name: "", phone: "" })

  function startCreate() {
    // Ce que le caissier a déjà tapé n'est pas à retaper : un numéro va au
    // champ téléphone, un nom au champ nom.
    const typed = query.trim()
    setDraft(phoneSearchDigits(typed) !== null ? { name: "", phone: typed } : { name: typed, phone: "" })
    setMode("create")
  }

  if (mode === "create") {
    return (
      <QuickCreateCustomer
        storeId={storeId}
        isOnline={isOnline}
        initial={draft}
        eyebrow={eyebrow}
        summary={summary}
        onCreated={onSelect}
        onBack={() => setMode("search")}
        onClose={onClose}
      />
    )
  }

  return (
    <CustomerSearch
      storeId={storeId}
      isOnline={isOnline}
      query={query}
      onQueryChange={setQuery}
      eyebrow={eyebrow}
      title={title}
      summary={summary}
      onSelect={onSelect}
      onCreate={startCreate}
      onBack={onBack}
      onClose={onClose}
    />
  )
}

function CustomerSearch({
  storeId,
  isOnline,
  query,
  onQueryChange,
  eyebrow,
  title,
  summary,
  onSelect,
  onCreate,
  onBack,
  onClose,
}: {
  storeId: string
  isOnline: boolean
  query: string
  onQueryChange: (value: string) => void
  eyebrow: string
  title: string
  summary?: ReactNode
  onSelect: (customer: CustomerSummary) => void
  onCreate: () => void
  onBack?: () => void
  onClose: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const term = useDebouncedValue(query.trim(), 150)
  const customersQuery = useQuery({
    queryKey: ["customers", storeId, term],
    queryFn: () => searchCustomers(storeId, term),
    enabled: term.length > 0,
    retry: false,
  })
  const customers = customersQuery.data ?? []
  const isSearching = term.length > 0 && customersQuery.isFetching

  useEffect(() => {
    setHighlightedIndex(0)
  }, [customersQuery.data])

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (customers.length === 0) return
    if (event.key === "ArrowDown") {
      event.preventDefault()
      setHighlightedIndex((index) => Math.min(index + 1, customers.length - 1))
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      setHighlightedIndex((index) => Math.max(index - 1, 0))
    } else if (event.key === "Enter") {
      event.preventDefault()
      const customer = customers[highlightedIndex] ?? customers[0]
      if (customer) onSelect(customer)
    }
  }

  return (
    <Dialog
      eyebrow={eyebrow}
      title={title}
      onClose={onClose}
      onBack={onBack}
      initialFocusRef={inputRef}
      className="customer-picker"
    >
      <DialogBody>
        {summary}
        <div className="field">
          <label htmlFor="customer-search-input">Téléphone ou nom du client</label>
          <input
            ref={inputRef}
            id="customer-search-input"
            autoComplete="off"
            placeholder="77 123 45 67 ou Moussa"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={handleKeyDown}
          />
        </div>

        <div className="customer-picker-results" aria-live="polite">
          {isSearching ? (
            <div className="product-list" aria-hidden="true">
              {[0, 1].map((index) => (
                <span className="product-result product-result-skeleton" key={index}>
                  <Skeleton width="45%" height="0.95rem" />
                  <Skeleton width="5.5rem" height="0.95rem" />
                </span>
              ))}
            </div>
          ) : null}
          {customersQuery.error ? (
            <InlineAlert tone="warning" title="Recherche indisponible">
              {customersQuery.error.message}
            </InlineAlert>
          ) : null}
          {!isSearching && !customersQuery.error && term && customers.length === 0 ? (
            <EmptyState
              compact
              title="Aucun client trouvé."
              description={
                isOnline
                  ? "Vérifiez le numéro ou le nom, ou créez le client."
                  : "Vérifiez le numéro ou le nom. La création d’un client nécessite une connexion."
              }
            />
          ) : null}
          {!isSearching && customers.length > 0 ? (
            <ul className="product-list">
              {customers.map((customer, index) => (
                <li key={customer.id}>
                  <button
                    type="button"
                    className={
                      index === highlightedIndex
                        ? "product-result product-result-highlighted"
                        : "product-result"
                    }
                    data-highlighted={index === highlightedIndex ? "true" : undefined}
                    aria-label={`Choisir ${customer.name}`}
                    onMouseEnter={() => setHighlightedIndex(index)}
                    onClick={() => onSelect(customer)}
                  >
                    <div>
                      <strong>{customer.name}</strong>
                      {customer.phone ? <span>{formatPhone(customer.phone)}</span> : null}
                    </div>
                    <div className="product-numbers">
                      {customer.balance > 0 ? (
                        <>
                          <span>Doit</span>
                          <strong className="customer-balance-due">
                            <Money value={customer.balance} />
                          </strong>
                        </>
                      ) : (
                        <span>Soldé</span>
                      )}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button
            variant="secondary"
            disabled={!isOnline}
            title={isOnline ? undefined : "La création d’un client nécessite une connexion."}
            onClick={onCreate}
          >
            + Nouveau client
          </Button>
        </DialogFooter>
      </DialogBody>
    </Dialog>
  )
}

function QuickCreateCustomer({
  storeId,
  isOnline,
  initial,
  eyebrow,
  summary,
  onCreated,
  onBack,
  onClose,
}: {
  storeId: string
  isOnline: boolean
  initial: { name: string; phone: string }
  eyebrow: string
  summary?: ReactNode
  onCreated: (customer: CustomerSummary) => void
  onBack: () => void
  onClose: () => void
}) {
  const nameRef = useRef<HTMLInputElement>(null)
  const phoneRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState(initial.name)
  const [phone, setPhone] = useState(initial.phone)
  const [validationError, setValidationError] = useState<string | null>(null)
  const createMutation = useMutation({
    mutationFn: quickCreateCustomer,
    onSuccess: (customer) => onCreated(customer),
  })
  const duplicate =
    createMutation.error instanceof DuplicateCustomerError ? createMutation.error.existing : null

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (createMutation.isPending) return
    const trimmedName = name.trim()
    const normalizedPhone = normalizePhone(phone)
    if (!trimmedName) {
      setValidationError("Le nom du client est obligatoire.")
      nameRef.current?.focus()
      return
    }
    if (normalizedPhone === null) {
      setValidationError("Numéro de téléphone invalide (ex. 77 123 45 67).")
      phoneRef.current?.focus()
      return
    }
    setValidationError(null)
    createMutation.mutate({ storeId, name: trimmedName, phone: normalizedPhone })
  }

  return (
    <Dialog
      eyebrow={eyebrow}
      title="Nouveau client"
      onClose={onClose}
      onBack={onBack}
      backDisabled={createMutation.isPending}
      initialFocusRef={initial.name ? phoneRef : nameRef}
    >
      <DialogForm onSubmit={handleSubmit}>
        {summary}
        <div className="field">
          <label htmlFor="customer-create-name">Nom</label>
          <input
            ref={nameRef}
            id="customer-create-name"
            autoComplete="off"
            placeholder="Moussa Fall"
            value={name}
            disabled={createMutation.isPending}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="customer-create-phone">Téléphone</label>
          <input
            ref={phoneRef}
            id="customer-create-phone"
            autoComplete="off"
            inputMode="tel"
            placeholder="77 123 45 67"
            value={phone}
            disabled={createMutation.isPending}
            onChange={(event) => setPhone(event.target.value)}
          />
        </div>

        {!isOnline ? (
          <InlineAlert tone="warning" title="Hors ligne">
            La création d’un client nécessite une connexion. Revenez en arrière pour choisir un
            client déjà enregistré.
          </InlineAlert>
        ) : null}
        {validationError ? <InlineAlert tone="error">{validationError}</InlineAlert> : null}
        {duplicate ? (
          <InlineAlert
            tone="warning"
            title="Client déjà enregistré"
            action={
              <Button variant="secondary" size="sm" onClick={() => onCreated(duplicate)}>
                Choisir {duplicate.name}
              </Button>
            }
          >
            Ce numéro appartient déjà à {duplicate.name}
            {duplicate.balance > 0 ? (
              <>
                {" "}(doit <Money value={duplicate.balance} />)
              </>
            ) : null}
            .
          </InlineAlert>
        ) : null}
        {createMutation.error && !duplicate ? (
          <InlineAlert tone="error">{describeErrorShort(createMutation.error, "client")}</InlineAlert>
        ) : null}

        <DialogFooter>
          <Button variant="ghost" onClick={onBack} disabled={createMutation.isPending}>
            Retour
          </Button>
          <Button
            variant="primary"
            type="submit"
            disabled={!isOnline}
            loading={createMutation.isPending}
            loadingLabel="Création…"
          >
            Créer le client
          </Button>
        </DialogFooter>
      </DialogForm>
    </Dialog>
  )
}
