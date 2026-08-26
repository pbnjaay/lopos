import { useQuery, useQueryClient } from "@tanstack/react-query"

import { PageHeader } from "../components/layout/PageHeader"
import { Badge } from "../components/ui/Badge"
import { Button } from "../components/ui/Button"
import { EmptyState } from "../components/ui/EmptyState"
import { InlineAlert } from "../components/ui/InlineAlert"
import { ListRow } from "../components/ui/ListRow"
import { Money } from "../components/ui/Money"
import { SectionHeader } from "../components/ui/SectionHeader"
import { SkeletonRows } from "../components/ui/Skeleton"
import { useToast } from "../components/ui/Toast"
import { listConflictLocalSales, listPendingLocalSales } from "../db/sales"
import { useNetworkStatus } from "../features/offline/useNetworkStatus"
import { describeSyncOutcome } from "../features/sync/syncCopy"
import { useSyncStatus } from "../features/sync/useSyncStatus"
import { formatDate, formatTime } from "../utils/date"

const paymentLabels = {
  CASH: "Espèces",
  WAVE: "Wave",
  ORANGE_MONEY: "Orange Money",
} as const

const pendingSalesQueryKey = ["pending-local-sales"] as const
const conflictSalesQueryKey = ["conflict-local-sales"] as const

export function PendingSalesPage() {
  const isOnline = useNetworkStatus()
  const { isSyncing, triggerSync } = useSyncStatus()
  const queryClient = useQueryClient()
  const toast = useToast()
  const pendingSalesQuery = useQuery({
    queryKey: pendingSalesQueryKey,
    queryFn: () => listPendingLocalSales(),
  })
  const conflictSalesQuery = useQuery({
    queryKey: conflictSalesQueryKey,
    queryFn: () => listConflictLocalSales(),
  })
  const sales = pendingSalesQuery.data ?? []
  const conflicts = conflictSalesQuery.data ?? []
  const isLoading = pendingSalesQuery.isLoading || conflictSalesQuery.isLoading

  async function handleSyncClick() {
    const outcome = await triggerSync()
    void queryClient.invalidateQueries({ queryKey: pendingSalesQueryKey })
    void queryClient.invalidateQueries({ queryKey: conflictSalesQueryKey })
    // Événement court : un toast, pas un message qui reste dans la page.
    if (outcome.conflicts > 0) {
      toast.warning("Synchronisation terminée", { description: describeSyncOutcome(outcome) })
    } else {
      toast.success("Synchronisation terminée", { description: describeSyncOutcome(outcome) })
    }
  }

  return (
    <main className="operational-page">
      <PageHeader
        backTo="/pos"
        backLabel="Retour au point de vente"
        eyebrow="Synchronisation locale"
        title="Ventes en attente"
        context={isLoading ? "Vérification en cours" : `${sales.length} en attente · ${conflicts.length} à vérifier`}
        actions={(
          <Button
            variant="primary"
            size="sm"
            disabled={!isOnline}
            loading={isSyncing}
            loadingLabel="Synchronisation…"
            onClick={() => void handleSyncClick()}
          >
            Synchroniser
          </Button>
        )}
      />

      <section className="operational-card pending-sales-card" aria-label="État de la synchronisation">
        <SectionHeader
          title="Synchronisation des ventes"
          description="Les ventes locales sont envoyées automatiquement dès que la connexion revient."
        />
        {!isOnline ? (
          <InlineAlert tone="warning" title="Mode hors ligne">
            Vous pouvez continuer à vendre. La synchronisation reprendra dès le retour de la connexion.
          </InlineAlert>
        ) : null}

        {isLoading ? <SkeletonRows count={3} label="Chargement des ventes en attente…" /> : null}

        {!isLoading && conflicts.length > 0 ? (
          <section className="pending-sales-section" aria-labelledby="conflict-sales-title">
            <SectionHeader
              title="Ventes à vérifier"
              titleId="conflict-sales-title"
              description="Ces ventes ont été refusées par le serveur et ne seront pas renvoyées automatiquement."
              trailing={<Badge tone="warning">{conflicts.length}</Badge>}
            />
            <div className="pending-sales-list">
              {conflicts.map((sale) => (
                <ListRow
                  key={sale.id}
                  tone="warning"
                  to={`/sales/${encodeURIComponent(sale.id)}/receipt?from=pending`}
                  leading={formatTime(sale.createdAt)}
                  title={<Money value={sale.total} />}
                  meta={formatDate(sale.createdAt)}
                  footnote={sale.conflictMessage}
                />
              ))}
            </div>
          </section>
        ) : null}

        {!isLoading && sales.length === 0 && conflicts.length === 0 ? (
          <EmptyState
            compact
            title="Aucune vente en attente de synchronisation."
            description="Toutes les ventes locales ont été envoyées au serveur."
          />
        ) : null}

        {sales.length > 0 ? (
          <section className="pending-sales-section" aria-labelledby="pending-sync-title">
            <SectionHeader
              title="En attente"
              titleId="pending-sync-title"
              trailing={<Badge tone="neutral">{sales.length}</Badge>}
            />
            <div className="pending-sales-list">
              {sales.map((sale) => (
                <ListRow
                  key={sale.id}
                  to={`/sales/${encodeURIComponent(sale.id)}/receipt?from=pending`}
                  leading={formatTime(sale.createdAt)}
                  title={<Money value={sale.total} />}
                  meta={
                    <>
                      <span>{paymentLabels[sale.payment.method]}</span>
                      <span aria-hidden="true">·</span>
                      <span>{formatDate(sale.createdAt)}</span>
                    </>
                  }
                />
              ))}
            </div>
          </section>
        ) : null}
      </section>
    </main>
  )
}
