import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "react-router-dom"

import { PageHeader } from "../components/layout/PageHeader"
import {
  ListFilterField,
  ListFilters,
  ListHint,
  ListSearchField,
  ListSummary,
} from "../components/list/ListPage"
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
import { useDebouncedValue } from "../hooks/useDebouncedValue"
import { useListNavigation } from "../hooks/useListNavigation"
import { formatDate, formatDateTime } from "../utils/date"
import { formatMoney } from "../utils/money"
import { formatPhone, phoneSearchDigits } from "../utils/phone"

type BalanceFilter = "all" | "due" | "settled"

const BALANCE_FILTER_OPTIONS: ReadonlyArray<{ value: BalanceFilter; label: string }> = [
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
 * Le cahier de la boutique : qui doit quoi, depuis quand. Même structure que
 * la page des ventes (voir `components/list/ListPage`). Par défaut, ceux qui
 * doivent, les plus gros soldes en tête — c'est la question que pose le
 * gérant en ouvrant le cahier.
 *
 * Lu depuis le cache local : consultable hors ligne, sans pagination (un
 * cahier de boutique tient en mémoire).
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
  const debouncedSearch = useDebouncedValue(search.trim(), 150)

  const customersQuery = useQuery({
    queryKey: ["customers", storeId, "book", book.lastSyncAt],
    queryFn: () => listCustomerBook(storeId!),
    enabled: storeId !== null,
    retry: false,
  })

  const customers = useMemo(
    () =>
      (customersQuery.data ?? [])
        .filter((customer) =>
          filter === "due" ? customer.balance > 0 : filter === "settled" ? customer.balance === 0 : true,
        )
        .filter((customer) => (debouncedSearch ? matchesSearch(customer, debouncedSearch) : true))
        .sort((left, right) =>
          filter === "settled"
            ? left.name.localeCompare(right.name, "fr")
            : right.balance - left.balance || left.name.localeCompare(right.name, "fr"),
        ),
    [customersQuery.data, filter, debouncedSearch],
  )
  const hasFilters = Boolean(debouncedSearch) || filter !== "all"
  const total = customers.reduce((sum, customer) => sum + customer.balance, 0)

  const isStale = search.trim() !== debouncedSearch
  const { highlightedIndex, setHighlightedIndex, aimedItem: aimedCustomer, handleKeyDown } =
    useListNavigation(customers, {
      onOpen: (customer) => navigate(`/customers/${customer.id}`),
      isStale,
      resetKey: `${filter}|${debouncedSearch}`,
    })

  const storeName = localSession?.storeName || "Boutique actuelle"

  return (
    <main className="operational-page">
      <PageHeader
        backTo="/pos"
        backLabel="Retour au point de vente"
        eyebrow="Cahier clients"
        title="Clients"
        context={`${storeName} · ${selectedRegister?.name ?? "Caisse"}`}
      />

      {!storeId ? (
        <ErrorState
          title="Caisse non rattachée à une boutique"
          description="Cette caisse n’est associée à aucune boutique. Contactez un responsable pour la reconfigurer."
        />
      ) : (
        <>
          {!online ? (
            <InlineAlert title="Hors connexion : cahier de cet appareil">
              {book.lastSyncAt ? `Soldes connus au ${formatDateTime(book.lastSyncAt)}, plus` : "Soldes connus, plus"}{" "}
              les ventes à crédit de cette caisse. L’historique et les paiements clients reviennent
              avec la connexion.
            </InlineAlert>
          ) : null}

          <ListFilters>
            <ListSearchField
              id="customers-search"
              label="Téléphone ou nom"
              placeholder="77 123 45 67 ou Moussa"
              value={search}
              onChange={setSearch}
              onKeyDown={handleKeyDown}
            />
            <ListFilterField label="Solde">
              <SegmentedControl
                label="Solde"
                options={BALANCE_FILTER_OPTIONS}
                value={filter}
                onChange={setFilter}
              />
            </ListFilterField>
          </ListFilters>

          <ListHint
            itemsLabel="les clients"
            openLabel="la fiche"
            isStale={isStale}
            announcement={
              aimedCustomer
                ? `Client visé : ${aimedCustomer.name}, ${aimedCustomer.balance > 0 ? `doit ${formatMoney(aimedCustomer.balance)}` : "soldé"}`
                : ""
            }
          />

          {customersQuery.isLoading ? <SkeletonRows count={6} label="Chargement du cahier…" /> : null}

          {customersQuery.error ? (
            <ErrorState
              error={customersQuery.error}
              context="client"
              title="Impossible de charger le cahier"
              onRetry={() => void customersQuery.refetch()}
            />
          ) : null}

          {!customersQuery.isLoading && !customersQuery.error && customers.length === 0 ? (
            <EmptyState
              title={debouncedSearch ? "Aucun client trouvé" : filter === "due" ? "Personne ne doit rien" : "Aucun client"}
              description={
                debouncedSearch
                  ? "Vérifiez le numéro ou le nom saisi."
                  : "Les clients apparaissent ici dès leur première vente mise au cahier."
              }
            />
          ) : null}

          {customers.length > 0 ? (
            <>
              <ListSummary
                label="Résultat de la recherche"
                count={
                  <>
                    <strong>{customers.length}</strong> client{customers.length > 1 ? "s" : ""}
                    {hasFilters ? ` trouvé${customers.length > 1 ? "s" : ""}` : ""}
                  </>
                }
                totalLabel="Total dû"
                total={total}
              />

              <section className="list-rows" aria-label="Clients du cahier">
                {customers.map((customer, index) => (
                  <ListRow
                    key={customer.id}
                    to={`/customers/${customer.id}`}
                    highlighted={index === highlightedIndex}
                    onMouseEnter={() => setHighlightedIndex(index)}
                    title={customer.name}
                    meta={
                      <>
                        <span>{customer.phone ? formatPhone(customer.phone) : "Sans téléphone"}</span>
                        {customer.lastActivityAt ? (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>{formatDate(customer.lastActivityAt)}</span>
                          </>
                        ) : null}
                      </>
                    }
                    trailing={
                      customer.balance > 0 ? (
                        <strong className="customer-balance-due">
                          <Money value={customer.balance} />
                        </strong>
                      ) : (
                        <span>Soldé</span>
                      )
                    }
                  />
                ))}
              </section>
            </>
          ) : null}
        </>
      )}
    </main>
  )
}
