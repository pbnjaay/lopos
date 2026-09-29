import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, useParams } from "react-router-dom"

import { getCustomerDetail } from "../api/customers"
import { PageHeader } from "../components/layout/PageHeader"
import { Button } from "../components/ui/Button"
import { PlusIcon } from "../components/ui/Icons"
import { InlineAlert } from "../components/ui/InlineAlert"
import { MetaList } from "../components/ui/Metadata"
import { Money } from "../components/ui/Money"
import { RouteError, RouteLoading } from "../components/ui/RouteState"
import { SectionHeader } from "../components/ui/SectionHeader"
import { pendingCreditByCustomer } from "../db/sales"
import { useCurrentUser } from "../features/auth/queries"
import { usePosSession } from "../features/cash-session/queries"
import { type CustomerSummary, getCachedCustomer } from "../features/customers/customerService"
import { RecordPaymentDialog } from "../features/customers/RecordPaymentDialog"
import { useNetworkStatus } from "../features/offline/useNetworkStatus"
import { PAYMENT_LABELS } from "../features/sales/paymentLabels"
import type { CustomerDetail, LedgerEntry } from "../types/api"
import { formatDateTime } from "../utils/date"
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
 * Fiche d'un client, sur le modèle de la fiche vente : actions dans
 * l'en-tête, puis une seule carte — informations, historique du cahier
 * (chaque ligne avec le solde juste après elle), récapitulatif.
 */
export function CustomerDetailPage() {
  const { customerId } = useParams<{ customerId: string }>()
  const user = useCurrentUser().data!
  const { selectedRegister, ownSession, localSession } = usePosSession(user)
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
  // Le cache local sert hors ligne.
  const cachedQuery = useQuery({
    queryKey: ["customers", storeId, "cached", customerId],
    queryFn: () => getCachedCustomer(storeId!, customerId!),
    enabled: Boolean(storeId && customerId),
  })
  // Ventes à crédit de cet appareil pas encore synchronisées : elles comptent
  // dans ce que le client doit, mais le serveur ne peut pas encore les
  // encaisser — elles sont affichées, pas proposées au paiement.
  const pendingQuery = useQuery({
    queryKey: ["customers", storeId, "pending", customerId],
    queryFn: async () => (await pendingCreditByCustomer(storeId!)).get(customerId!) ?? 0,
    enabled: Boolean(storeId && customerId),
  })
  const cached = cachedQuery.data ?? null

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
  const storeName = localSession?.storeName || "Boutique actuelle"

  return (
    <main className="operational-page">
      <PageHeader
        backTo="/customers"
        backLabel="Retour au cahier"
        eyebrow="Client"
        title={customer.name}
        context={`${storeName} · ${selectedRegister?.name ?? "Caisse"}`}
        actions={
          canPay ? (
            <Button variant="primary" size="sm" onClick={() => setIsPaying(true)}>
              <PlusIcon />
              <span>Enregistrer un paiement</span>
            </Button>
          ) : null
        }
      />

      <section className="operational-card sale-detail-card">
        <MetaList
          label="Informations du client"
          items={[
            { label: "Téléphone", value: customer.phone ? formatPhone(customer.phone) : "—" },
            {
              label: "Dernière activité",
              value: customer.lastActivityAt ? formatDateTime(customer.lastActivityAt) : "Aucune",
            },
            { label: "Statut", value: customer.isActive ? "Actif" : "Désactivé" },
          ]}
        />

        {detail ? (
          <div className="card-section">
            <SectionHeader
              title="Historique"
              trailing={`${detail.entries.length} ligne${detail.entries.length > 1 ? "s" : ""}`}
            />
            {detail.entries.length > 0 ? (
              <ul className="sale-detail-items" aria-label="Historique du cahier">
                {detail.entries.map((entry) => {
                  const amount = Math.round(Number(entry.amount))
                  return (
                    <li key={entry.id}>
                      <div>
                        <strong>{entryTitle(entry)}</strong>
                        <span>
                          {formatDateTime(entry.occurred_at)}
                          {entry.created_by ? ` · ${entry.created_by}` : ""}
                        </span>
                        {entry.reason ? <span>{entry.reason}</span> : null}
                        <EntryLink entry={entry} />
                      </div>
                      <div>
                        <strong>
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
              </ul>
            ) : null}
          </div>
        ) : null}

        <div className="sale-detail-summary">
          <p className="eyebrow">Récapitulatif</p>
          <dl className="sale-detail-totals" aria-label="Solde du client">
            {pendingCredit > 0 && serverCustomer ? (
              <>
                <div>
                  <dt>Connu du serveur</dt>
                  <dd>
                    <Money value={serverCustomer.balance} />
                  </dd>
                </div>
                <div>
                  <dt>Ventes en attente de synchronisation</dt>
                  <dd>
                    <Money value={pendingCredit} />
                  </dd>
                </div>
              </>
            ) : null}
            <div className="sale-detail-net">
              <dt>Solde dû</dt>
              <dd>
                <Money value={customer.balance} />
              </dd>
            </div>
          </dl>
        </div>

        {!online ? (
          <InlineAlert className="sale-detail-note">
            Solde connu de cet appareil. L’historique et les paiements reviennent avec la connexion.
          </InlineAlert>
        ) : detail && detail.entries.length === 0 ? (
          <InlineAlert className="sale-detail-note">Ce cahier est vide pour l’instant.</InlineAlert>
        ) : customer.balance === 0 ? (
          <InlineAlert className="sale-detail-note">Ce client ne doit rien.</InlineAlert>
        ) : null}
      </section>

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
