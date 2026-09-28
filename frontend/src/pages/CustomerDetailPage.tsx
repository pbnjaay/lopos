import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, useParams } from "react-router-dom"

import { getCustomerDetail } from "../api/customers"
import { PageHeader } from "../components/layout/PageHeader"
import { Button } from "../components/ui/Button"
import { EmptyState } from "../components/ui/EmptyState"
import { InlineAlert } from "../components/ui/InlineAlert"
import { Money } from "../components/ui/Money"
import { RouteError, RouteLoading } from "../components/ui/RouteState"
import { SectionHeader } from "../components/ui/SectionHeader"
import { useCurrentUser } from "../features/auth/queries"
import { pendingCreditByCustomer } from "../db/sales"
import { usePosSession } from "../features/cash-session/queries"
import { type CustomerSummary, getCachedCustomer } from "../features/customers/customerService"
import { RecordPaymentDialog } from "../features/customers/RecordPaymentDialog"
import { useNetworkStatus } from "../features/offline/useNetworkStatus"
import { PAYMENT_LABELS } from "../features/sales/paymentLabels"
import type { CustomerDetail, LedgerEntry } from "../types/api"
import { formatDate, formatTime } from "../utils/date"
import { formatPhone } from "../utils/phone"

export function customerDetailQueryKey(customerId: string | undefined) {
  return ["customers", "detail", customerId] as const
}

/** Le client tel que le serveur le connaît : son solde est ce qui peut être payé maintenant. */
function toSummary(detail: CustomerDetail): CustomerSummary {
  return {
    id: detail.id,
    name: detail.name,
    phone: detail.phone,
    balance: Math.round(Number(detail.balance)),
    isActive: detail.is_active,
    lastActivityAt: detail.last_activity_at,
  }
}

/** « Achat », « Paiement Wave »… : ce que dit le cahier papier. */
function entryTitle(entry: LedgerEntry): string {
  if (entry.entry_type === "PAYMENT" && entry.customer_payment) {
    return `Paiement ${PAYMENT_LABELS[entry.customer_payment.method]}`
  }
  if (entry.entry_type === "CREDIT_SALE") return "Achat"
  return entry.label
}

function EntryLink({ entry }: { entry: LedgerEntry }) {
  if (entry.customer_payment) {
    return (
      <Link to={`/customer-payments/${entry.customer_payment.id}/receipt`}>
        Reçu {entry.customer_payment.reference}
      </Link>
    )
  }
  if (entry.sale_id) {
    return <Link to={`/sales/${entry.sale_id}`}>Ticket {entry.sale_id.slice(0, 8).toUpperCase()}</Link>
  }
  return null
}

/**
 * Fiche d'un client : ce qu'il doit, et chaque ligne de son cahier avec le
 * solde juste après — exactement comme on relit un cahier papier.
 */
export function CustomerDetailPage() {
  const { customerId } = useParams<{ customerId: string }>()
  const user = useCurrentUser().data!
  const { selectedRegister, ownSession } = usePosSession(user)
  const storeId = selectedRegister?.store_id ?? null
  const online = useNetworkStatus()
  const queryClient = useQueryClient()
  const [isPaying, setIsPaying] = useState(false)

  const detailQuery = useQuery({
    queryKey: customerDetailQueryKey(customerId),
    queryFn: () => getCustomerDetail(customerId!),
    enabled: Boolean(customerId && online),
    retry: false,
  })
  // Le cache local sert hors ligne, et ajoute la dette des ventes à crédit
  // de cet appareil que le serveur ne connaît pas encore.
  const cachedQuery = useQuery({
    queryKey: ["customers", storeId, "cached", customerId],
    queryFn: () => getCachedCustomer(storeId!, customerId!),
    enabled: Boolean(storeId && customerId),
  })
  const cached = cachedQuery.data ?? null
  const pendingQuery = useQuery({
    queryKey: ["customers", storeId, "pending", customerId],
    queryFn: async () => (await pendingCreditByCustomer(storeId!)).get(customerId!) ?? 0,
    enabled: Boolean(storeId && customerId),
  })

  if (!customerId) {
    return <RouteError context="client" title="Client introuvable" description="Ce client n’existe pas." />
  }
  if (online && detailQuery.isLoading) return <RouteLoading message="Chargement du client…" />
  if (online && detailQuery.error && !cached) {
    return (
      <RouteError error={detailQuery.error} context="client" onRetry={() => void detailQuery.refetch()} />
    )
  }

  const detail = online ? (detailQuery.data ?? null) : null
  // Ventes à crédit de cet appareil pas encore synchronisées : elles comptent
  // dans ce que le client doit, mais le serveur ne peut pas encore les
  // encaisser — elles sont affichées, pas proposées au paiement.
  const pendingCredit = pendingQuery.data ?? 0
  const serverCustomer = detail ? toSummary(detail) : null
  const customer: CustomerSummary | null = serverCustomer
    ? { ...serverCustomer, balance: serverCustomer.balance + pendingCredit }
    : cached
  if (!customer) {
    return cachedQuery.isLoading ? (
      <RouteLoading message="Chargement du client…" />
    ) : (
      <RouteError
        context="client"
        title="Client indisponible hors ligne"
        description="Ce client n’est pas encore dans le cahier de cet appareil. Reconnectez-vous pour l’afficher."
      />
    )
  }

  const canPay =
    online && ownSession !== null && storeId !== null && serverCustomer !== null && serverCustomer.balance > 0

  return (
    <main className="operational-page">
      <PageHeader
        backTo="/customers"
        backLabel="Retour au cahier"
        eyebrow="Cahier client"
        title={customer.name}
        context={customer.phone ? formatPhone(customer.phone) : "Sans téléphone"}
        actions={
          <Button variant="primary" disabled={!canPay} onClick={() => setIsPaying(true)}>
            Enregistrer un paiement
          </Button>
        }
      />

      <section className="operational-card customer-balance-card" aria-label="Solde du client">
        <span>Solde dû</span>
        <strong className={customer.balance > 0 ? "customer-balance-due" : undefined}>
          <Money value={customer.balance} />
        </strong>
        {pendingCredit > 0 ? (
          <small>
            dont <Money value={pendingCredit} /> de ventes en attente de synchronisation
          </small>
        ) : null}
        {!customer.isActive ? <small>Client désactivé</small> : null}
      </section>

      {!online ? (
        <InlineAlert title="Hors connexion">
          Solde connu de cet appareil. L’historique et les paiements reviennent avec la connexion.
        </InlineAlert>
      ) : null}

      {detail ? (
        <section className="operational-card" aria-label="Historique du cahier">
          <div className="card-section">
            <SectionHeader
              title="Historique"
              trailing={`${detail.entries.length} ligne${detail.entries.length > 1 ? "s" : ""}`}
            />
          </div>
          {detail.entries.length === 0 ? (
            <EmptyState compact title="Aucune écriture" description="Ce cahier est vide pour l’instant." />
          ) : (
            <ol className="ledger-list">
              {detail.entries.map((entry) => {
                const amount = Math.round(Number(entry.amount))
                return (
                  <li key={entry.id} className="ledger-row">
                    <div className="ledger-row-main">
                      <strong>{entryTitle(entry)}</strong>
                      <span>
                        {formatDate(entry.occurred_at)} · {formatTime(entry.occurred_at)}
                        {entry.created_by ? ` · ${entry.created_by}` : ""}
                      </span>
                      {entry.reason ? <small>{entry.reason}</small> : null}
                      <EntryLink entry={entry} />
                    </div>
                    <div className="ledger-row-numbers">
                      <strong className={amount > 0 ? "ledger-amount-debit" : "ledger-amount-credit"}>
                        {amount > 0 ? "+ " : "− "}
                        <Money value={Math.abs(amount)} />
                      </strong>
                      <span>
                        Solde <Money backend={entry.running_balance} />
                      </span>
                    </div>
                  </li>
                )
              })}
            </ol>
          )}
        </section>
      ) : null}

      {isPaying && ownSession && storeId && serverCustomer ? (
        <RecordPaymentDialog
          customer={serverCustomer}
          storeId={storeId}
          cashSessionId={ownSession.id}
          onRecorded={() => {
            void queryClient.invalidateQueries({ queryKey: ["customers"] })
          }}
          onClose={() => setIsPaying(false)}
        />
      ) : null}
    </main>
  )
}
