import { type FormEvent, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "react-router-dom"

import { closeCashSession, getCashSessionSummary } from "../api/cashSessions"
import { trackCashSessionClosed } from "../analytics/events"
import { PageHeader } from "../components/layout/PageHeader"
import { Button } from "../components/ui/Button"
import { Dialog, DialogBody, DialogFooter } from "../components/ui/Dialog"
import { InlineAlert } from "../components/ui/InlineAlert"
import { MetaList } from "../components/ui/Metadata"
import { Money } from "../components/ui/Money"
import { RouteError, RouteLoading } from "../components/ui/RouteState"
import { SectionHeader } from "../components/ui/SectionHeader"
import { useToast } from "../components/ui/Toast"
import { getSessionCartBlockers } from "../db/carts"
import { countPendingLocalSalesForSession } from "../db/sales"
import { markLocalCashSessionClosed } from "../db/sessions"
import { useCurrentUser } from "../features/auth/queries"
import { CashClosingResult } from "../features/cash-session/CashClosingResult"
import { usePosSession } from "../features/cash-session/queries"
import { useNetworkStatus } from "../features/offline/useNetworkStatus"
import { useSyncStatus } from "../features/sync/useSyncStatus"
import { describeSyncOutcome } from "../features/sync/syncCopy"
import { formatDateTime } from "../utils/date"
import { describeErrorShort } from "../utils/errorCopy"
import { formatMoney, parseMoneyInput, toBackendMoney } from "../utils/money"

export function CloseCashSessionPage() {
  const user = useCurrentUser().data!
  const { ownSession, localSession } = usePosSession(user)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const toast = useToast()
  const confirmButtonRef = useRef<HTMLButtonElement>(null)
  const [countedCash, setCountedCash] = useState("")
  const [isConfirming, setIsConfirming] = useState(false)
  const parsedCountedCash = parseMoneyInput(countedCash)
  const hasCountedCash = countedCash.trim().length > 0
  const isInvalidCountedCash = hasCountedCash && parsedCountedCash === null
  const isOnline = useNetworkStatus()
  const { isSyncing, triggerSync } = useSyncStatus()
  const summaryQuery = useQuery({
    queryKey: ["cash-sessions", ownSession?.id, "summary"],
    queryFn: () => getCashSessionSummary(ownSession!.id),
    enabled: ownSession !== null,
  })
  const pendingLocalSalesQueryKey = ["pending-local-sales-for-session", ownSession?.id] as const
  const pendingLocalSalesQuery = useQuery({
    queryKey: pendingLocalSalesQueryKey,
    queryFn: () => countPendingLocalSalesForSession(ownSession!.id),
    enabled: ownSession !== null,
  })
  const cartBlockersQueryKey = ["session-cart-blockers", ownSession?.id] as const
  const cartBlockersQuery = useQuery({
    queryKey: cartBlockersQueryKey,
    queryFn: () => getSessionCartBlockers(ownSession!.id),
    enabled: ownSession !== null,
  })
  const closeMutation = useMutation({
    mutationFn: (amount: number) =>
      closeCashSession(ownSession!.id, { counted_cash: toBackendMoney(amount) }),
    onSuccess: async (closedSummary) => {
      try {
        await markLocalCashSessionClosed(ownSession!.cash_register_id)
      } catch {
        // The server session is already closed; do not invite a duplicate request.
      }
      void queryClient.invalidateQueries({ queryKey: ["local-cash-session"] })
      setIsConfirming(false)
      queryClient.setQueryData(
        ["cash-sessions", closedSummary.id, "summary"],
        closedSummary,
      )
      trackCashSessionClosed({
        cash_session_id: closedSummary.id,
        store_id: null,
        cash_register_id: closedSummary.cash_register.id,
        sales_count: closedSummary.sales_count,
        gross_sales: Math.round(Number(closedSummary.gross_sales)),
        cash_difference:
          closedSummary.cash_difference !== null
            ? Math.round(Number(closedSummary.cash_difference))
            : null,
      })
    },
  })

  function handleContinue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (parsedCountedCash === null || closeMutation.isPending) return
    closeMutation.reset()
    setIsConfirming(true)
  }

  if (!ownSession || summaryQuery.isLoading) {
    return <RouteLoading message="Chargement du résumé de caisse…" />
  }
  if (summaryQuery.error) {
    return (
      <RouteError
        error={summaryQuery.error}
        context="cloture"
        onRetry={() => void summaryQuery.refetch()}
      />
    )
  }

  const summary = summaryQuery.data
  if (!summary) return <RouteLoading message="Chargement du résumé de caisse…" />
  const cashRegisterId = ownSession.cash_register_id

  function clearCurrentSessionCache() {
    queryClient.setQueryData(
      ["cash-registers", cashRegisterId, "current-session"],
      null,
    )
  }

  if (closeMutation.data) {
    return (
      <CashClosingResult
        summary={closeMutation.data}
        onFinish={() => {
          clearCurrentSessionCache()
          navigate("/cash/open", { replace: true })
        }}
      />
    )
  }

  if (pendingLocalSalesQuery.isLoading || cartBlockersQuery.isLoading) {
    return <RouteLoading message="Vérification des ventes en attente…" />
  }

  const pendingLocalSalesCount = pendingLocalSalesQuery.data ?? 0
  const cartBlockers = cartBlockersQuery.data ?? { activeItemCount: 0, heldCount: 0 }
  const cashContext = localSession?.storeName
    ? `${localSession.storeName} · ${summary.cash_register.name}`
    : summary.cash_register.name

  if (cartBlockers.activeItemCount > 0 || cartBlockers.heldCount > 0) {
    const messages: string[] = []
    if (cartBlockers.activeItemCount > 0) {
      messages.push(
        `La vente en cours contient ${cartBlockers.activeItemCount} article${cartBlockers.activeItemCount > 1 ? "s" : ""}.`,
      )
    }
    if (cartBlockers.heldCount > 0) {
      messages.push(
        `${cartBlockers.heldCount} panier${cartBlockers.heldCount > 1 ? "s" : ""} en attente n'${cartBlockers.heldCount > 1 ? "ont" : "a"} pas été repris ou supprimé${cartBlockers.heldCount > 1 ? "s" : ""}.`,
      )
    }

    return (
      <main className="operational-page operational-page-narrow">
        <PageHeader
          backTo="/pos"
          backLabel="Retour au point de vente"
          eyebrow="Fin de journée"
          title="Clôturer la caisse"
          context={cashContext}
        />
        <section className="operational-card closing-sheet" aria-label="Vente ou panier non résolu">
          <div className="card-section">
            <SectionHeader
              eyebrow="Avant de clôturer"
              title="Vente en cours ou panier en attente"
              description="La clôture attend qu'il n'y ait plus aucune vente à finaliser sur cette session."
            />
            {/* Blocage réel : fermer la caisse ne doit jamais faire perdre
                une vente scannée ou mise en attente. */}
            <InlineAlert
              tone="warning"
              title="Terminez ou libérez la caisse avant de clôturer"
              action={
                <Button variant="primary" size="sm" onClick={() => navigate("/pos")}>
                  Retour au point de vente
                </Button>
              }
            >
              {messages.join(" ")}
            </InlineAlert>
          </div>
        </section>
      </main>
    )
  }

  if (pendingLocalSalesCount > 0) {
    async function handleSyncClick() {
      const outcome = await triggerSync()
      void queryClient.invalidateQueries({ queryKey: pendingLocalSalesQueryKey })
      // Événement court : un toast, pas un message figé dans la page.
      toast.success("Synchronisation terminée", { description: describeSyncOutcome(outcome) })
    }

    return (
      <main className="operational-page operational-page-narrow">
        <PageHeader
          backTo="/pos"
          backLabel="Retour au point de vente"
          eyebrow="Fin de journée"
          title="Clôturer la caisse"
          context={cashContext}
        />
        <section className="operational-card closing-sheet" aria-label="Synchronisation avant clôture">
          <div className="card-section">
            <SectionHeader
              eyebrow="Avant de clôturer"
              title="Ventes en attente"
              description="La clôture attend que toutes les ventes de cette session soient parvenues au serveur."
            />
            {/* Blocage réel : la clôture est impossible tant que des ventes
                locales n'ont pas été envoyées. Le message dit quoi faire et
                porte l'action de reprise. */}
            <InlineAlert
              tone="warning"
              title={`${pendingLocalSalesCount} vente${pendingLocalSalesCount > 1 ? "s" : ""} en attente`}
              action={
                <Button
                  variant="primary"
                  size="sm"
                  disabled={!isOnline}
                  loading={isSyncing}
                  loadingLabel="Synchronisation…"
                  onClick={() => void handleSyncClick()}
                >
                  Synchroniser maintenant
                </Button>
              }
            >
              {isOnline
                ? "Lancez la synchronisation, puis reprenez la clôture."
                : "Reconnectez cet appareil à Internet pour lancer la synchronisation."}
            </InlineAlert>
          </div>
        </section>
      </main>
    )
  }

  return (
    <main className="operational-page operational-page-narrow">
      <PageHeader
        backTo="/pos"
        backLabel="Retour au point de vente"
        eyebrow="Fin de journée"
        title="Clôturer la caisse"
        context={cashContext}
      />
      <section className="operational-card closing-sheet" aria-label="Résumé de clôture">
        <MetaList
          columns={2}
          label="Informations de la session"
          items={[
            { label: "Caissier", value: summary.cashier.username },
            { label: "Ouverture", value: formatDateTime(summary.opened_at) },
          ]}
        />

        <div className="card-section">
          <SectionHeader
            eyebrow="Activité"
            title="Résumé de la session"
            trailing="Depuis l’ouverture de la caisse"
          />
          <dl className="closing-summary" aria-label="Résumé de la session">
            <div className="closing-summary-kpi">
              <dt>Nombre de ventes</dt>
              <dd>{summary.sales_count}</dd>
            </div>
            <div className="closing-summary-kpi">
              <dt>Chiffre d’affaires</dt>
              <dd><Money backend={summary.gross_sales} /></dd>
            </div>
            <div className="closing-summary-payment">
              <dt>Espèces</dt>
              <dd><Money backend={summary.payments.cash} /></dd>
            </div>
            <div className="closing-summary-payment">
              <dt>Wave</dt>
              <dd><Money backend={summary.payments.wave} /></dd>
            </div>
            <div className="closing-summary-payment">
              <dt>Orange Money</dt>
              <dd><Money backend={summary.payments.orange_money} /></dd>
            </div>
            <div className="closing-summary-opening">
              <dt>Fond initial</dt>
              <dd><Money backend={summary.opening_balance} /></dd>
            </div>
          </dl>
        </div>

        <section className="closing-count-section" aria-labelledby="closing-count-title">
          <SectionHeader
            eyebrow="Dernière étape"
            title="Comptage des espèces"
            titleId="closing-count-title"
            trailing="Comptez uniquement l’argent présent dans le tiroir-caisse."
          />

          <form className="counted-cash-form" onSubmit={handleContinue}>
            <div className="field field-lg counted-cash-field">
              <label htmlFor="counted-cash">Montant compté</label>
              <div className="counted-cash-input-row">
                <div className="money-input">
                  <input
                    id="counted-cash"
                    autoFocus
                    inputMode="numeric"
                    placeholder="29 500"
                    value={countedCash}
                    disabled={closeMutation.isPending}
                    aria-describedby="counted-cash-help"
                    aria-invalid={isInvalidCountedCash}
                    onChange={(event) => setCountedCash(event.target.value)}
                  />
                  <span>FCFA</span>
                </div>
                <Button
                  variant="primary"
                  size="lg"
                  type="submit"
                  disabled={parsedCountedCash === null || closeMutation.isPending}
                >
                  Vérifier la clôture
                </Button>
              </div>
              {/* Validation de champ : au plus près du champ, jamais en toast. */}
              <small id="counted-cash-help" className={isInvalidCountedCash ? "field-error" : undefined}>
                {parsedCountedCash !== null
                  ? formatMoney(parsedCountedCash)
                  : hasCountedCash
                    ? "Saisissez un montant positif ou nul, sans décimales."
                    : "Montant entier, sans décimales"}
              </small>
            </div>
          </form>
        </section>
      </section>

      {isConfirming ? (
        <Dialog
          eyebrow="Confirmation"
          title={`Clôturer ${summary.cash_register.name} ?`}
          size="sm"
          dismissible={!closeMutation.isPending}
          // Action irréversible : le focus reste sur « Annuler », Entrée ne
          // clôture jamais par inadvertance.
          initialFocusRef={confirmButtonRef}
          onClose={() => {
            closeMutation.reset()
            setIsConfirming(false)
          }}
        >
          <DialogBody>
            <p>
              Montant compté : <strong>{formatMoney(parsedCountedCash!)}</strong>
            </p>
            <InlineAlert tone="warning">
              Après cette opération, aucune nouvelle vente ne pourra être enregistrée sur cette
              session.
            </InlineAlert>

            {closeMutation.error ? (
              <InlineAlert tone="error">
                {describeErrorShort(closeMutation.error, "cloture")}
              </InlineAlert>
            ) : null}

            <DialogFooter>
              <Button
                ref={confirmButtonRef}
                variant="secondary"
                disabled={closeMutation.isPending}
                onClick={() => {
                  closeMutation.reset()
                  setIsConfirming(false)
                }}
              >
                Annuler
              </Button>
              <Button
                variant="destructive"
                loading={closeMutation.isPending}
                loadingLabel="Clôture…"
                onClick={() => closeMutation.mutate(parsedCountedCash!)}
              >
                Confirmer la clôture
              </Button>
            </DialogFooter>
          </DialogBody>
        </Dialog>
      ) : null}
    </main>
  )
}
