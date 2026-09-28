import { type KeyboardEvent, useEffect, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "react-router-dom"

import { PageHeader } from "../components/layout/PageHeader"
import { EmptyState } from "../components/ui/EmptyState"
import { ErrorState } from "../components/ui/ErrorState"
import { InlineAlert } from "../components/ui/InlineAlert"
import { ListRow } from "../components/ui/ListRow"
import { Money } from "../components/ui/Money"
import { SegmentedControl } from "../components/ui/SegmentedControl"
import { SkeletonRows } from "../components/ui/Skeleton"
import { normalizeSearchText } from "../db/customers"
import { useCurrentUser } from "../features/auth/queries"
import { usePosSession } from "../features/cash-session/queries"
import { type CustomerSummary, listCustomerBook } from "../features/customers/customerService"
import { useCustomerBook } from "../features/customers/queries"
import { useNetworkStatus } from "../features/offline/useNetworkStatus"
import { formatDate, formatDateTime } from "../utils/date"
import { formatPhone, phoneSearchDigits } from "../utils/phone"

type BalanceFilter = "all" | "due" | "settled"

const FILTER_OPTIONS: ReadonlyArray<{ value: BalanceFilter; label: string }> = [
  { value: "all", label: "Tous" },
  { value: "due", label: "Avec solde" },
  { value: "settled", label: "Soldés" },
]

function matchesSearch(customer: CustomerSummary, search: string): boolean {
  const digits = phoneSearchDigits(search)
  if (digits !== null) return customer.phone?.replaceAll(/\D/g, "").includes(digits) ?? false
  const name = normalizeSearchText(customer.name)
  return normalizeSearchText(search)
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => name.includes(word))
}

/**
 * Le cahier de la boutique : qui doit quoi, depuis quand. Par défaut les
 * plus gros soldes en tête — c'est la question que pose le gérant en
 * ouvrant le cahier.
 */
export function CustomersPage() {
  const navigate = useNavigate()
  const user = useCurrentUser().data!
  const { selectedRegister, localSession } = usePosSession(user)
  const storeId = selectedRegister?.store_id ?? null
  const online = useNetworkStatus()
  const book = useCustomerBook(storeId)
  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState<BalanceFilter>("due")
  const [highlightedIndex, setHighlightedIndex] = useState(0)

  const customersQuery = useQuery({
    queryKey: ["customers", storeId, "book", book.lastSyncAt],
    queryFn: () => listCustomerBook(storeId!),
    enabled: storeId !== null,
    retry: false,
  })

  const allCustomers = customersQuery.data ?? []
  const customers = useMemo(() => {
    const trimmed = search.trim()
    return allCustomers
      .filter((customer) =>
        filter === "due" ? customer.balance > 0 : filter === "settled" ? customer.balance === 0 : true,
      )
      .filter((customer) => (trimmed ? matchesSearch(customer, trimmed) : true))
      .sort((left, right) =>
        filter === "settled"
          ? left.name.localeCompare(right.name, "fr")
          : right.balance - left.balance || left.name.localeCompare(right.name, "fr"),
      )
  }, [allCustomers, filter, search])
  const outstanding = allCustomers.reduce((sum, customer) => sum + customer.balance, 0)
  const debtors = allCustomers.filter((customer) => customer.balance > 0).length

  useEffect(() => {
    setHighlightedIndex(0)
  }, [search, filter])

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (customers.length === 0) return
    if (event.key === "ArrowDown") {
      event.preventDefault()
      setHighlightedIndex((index) => Math.min(index + 1, customers.length - 1))
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      setHighlightedIndex((index) => Math.max(index - 1, 0))
    } else if (event.key === "Enter") {
      event.preventDefault()
      const customer = customers[highlightedIndex]
      if (customer) navigate(`/customers/${customer.id}`)
    }
  }

  if (!storeId) {
    return (
      <ErrorState
        title="Caisse non rattachée à une boutique"
        description="Cette caisse n’est associée à aucune boutique. Contactez un responsable pour la reconfigurer."
      />
    )
  }

  return (
    <main className="operational-page">
      <PageHeader
        backTo="/pos"
        backLabel="Retour au point de vente"
        eyebrow="Cahier clients"
        title="Clients"
        context={localSession?.storeName || "Boutique actuelle"}
      />

      {!online && book.lastSyncAt ? (
        <InlineAlert title="Hors connexion">
          Soldes connus au {formatDateTime(book.lastSyncAt)}, plus les ventes à crédit de cet
          appareil. Les paiements clients reviennent avec la connexion.
        </InlineAlert>
      ) : null}

      <div className="sales-summary" role="status" aria-label="Encours du cahier">
        <span>
          <strong>{debtors}</strong> client{debtors > 1 ? "s" : ""} avec un solde
        </span>
        <span className="sales-summary-total">
          <span>Encours total</span>
          <strong>
            <Money value={outstanding} />
          </strong>
        </span>
      </div>

      <form className="sales-filters customers-filters" role="search" onSubmit={(event) => event.preventDefault()}>
        <div className="field sales-search-field">
          <label htmlFor="customers-search">Téléphone ou nom</label>
          <input
            id="customers-search"
            autoFocus
            autoComplete="off"
            placeholder="77 123 45 67 ou Moussa"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={handleSearchKeyDown}
          />
        </div>
        <SegmentedControl label="Filtrer les clients" options={FILTER_OPTIONS} value={filter} onChange={setFilter} />
      </form>

      {customersQuery.isLoading ? (
        <SkeletonRows count={4} label="Chargement du cahier…" />
      ) : customersQuery.error ? (
        <InlineAlert tone="warning" title="Cahier indisponible">
          {customersQuery.error.message}
        </InlineAlert>
      ) : customers.length === 0 ? (
        <EmptyState
          role="status"
          title={search.trim() ? "Aucun client trouvé." : filter === "due" ? "Personne ne doit rien." : "Aucun client."}
          description={
            search.trim()
              ? "Vérifiez le numéro ou le nom."
              : "Les clients apparaissent ici dès leur première vente mise au cahier."
          }
        />
      ) : (
        <section className="sales-list" aria-label="Clients du cahier">
          {customers.map((customer, index) => (
            <ListRow
              key={customer.id}
              to={`/customers/${customer.id}`}
              highlighted={index === highlightedIndex}
              onMouseEnter={() => setHighlightedIndex(index)}
              title={customer.name}
              meta={customer.phone ? formatPhone(customer.phone) : "Sans téléphone"}
              trailing={
                customer.balance > 0 ? (
                  <strong className="customer-balance-due">
                    <Money value={customer.balance} />
                  </strong>
                ) : (
                  <span>Soldé</span>
                )
              }
              footnote={
                customer.lastActivityAt
                  ? `Dernière activité : ${formatDate(customer.lastActivityAt)}`
                  : "Aucune activité"
              }
            />
          ))}
        </section>
      )}
    </main>
  )
}
