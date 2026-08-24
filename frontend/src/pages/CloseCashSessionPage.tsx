import { type FormEvent, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "react-router-dom"

import { closeCashSession, getCashSessionSummary } from "../api/cashSessions"
import { trackCashSessionClosed } from "../analytics/events"
import { OperationalPageHeader } from "../components/layout/OperationalPageHeader"
import { RouteState } from "../components/ui/RouteState"
import { Dialog } from "../components/ui/Dialog"
import { countPendingLocalSalesForSession } from "../db/sales"
import { markLocalCashSessionClosed } from "../db/sessions"
import { useCurrentUser } from "../features/auth/queries"
import { CashClosingResult } from "../features/cash-session/CashClosingResult"
import { usePosSession } from "../features/cash-session/queries"
import { useNetworkStatus } from "../features/offline/useNetworkStatus"
import { useSyncStatus } from "../features/sync/useSyncStatus"
import type { SyncOutcome } from "../sync/syncEngine"
import { formatDateTime } from "../utils/date"
import {
  formatBackendMoney,
  formatMoney,
  parseMoneyInput,
  toBackendMoney,
} from "../utils/money"

function describeSyncOutcome(outcome: SyncOutcome): string {
  if (outcome.attempted === 0) return "Aucune vente à synchroniser."
  if (outcome.conflicts > 0) {
    return `${outcome.synced} vente${outcome.synced > 1 ? "s" : ""} synchronisée${outcome.synced > 1 ? "s" : ""}, ${outcome.conflicts} en conflit.`
  }
  return `${outcome.synced} vente${outcome.synced > 1 ? "s" : ""} synchronisée${outcome.synced > 1 ? "s" : ""}.`
}

export function CloseCashSessionPage() {
  const user = useCurrentUser().data!
  const { ownSession, localSession } = usePosSession(user)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [countedCash, setCountedCash] = useState("")
  const [isConfirming, setIsConfirming] = useState(false)
  const [syncResultMessage, setSyncResultMessage] = useState<string | null>(null)
  const parsedCountedCash = parseMoneyInput(countedCash)
  const hasCountedCash = countedCash.trim().length > 0
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
  const closeMutation = useMutation({
    mutationFn: (amount: number) =>
      closeCashSession(ownSession!.id, { counted_cash: toBackendMoney(amount) }),
    onSuccess: async (closedSummary) => {
      try {
        await markLocalCashSessionClosed(ownSession!.cash_register_id)
      } catch {
        // The server session is already closed; do not invite a duplicate request.
      }
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
    return <RouteState message="Chargement du résumé de caisse…" />
  }
  if (summaryQuery.error) {
    return (
      <RouteState
        message=""
        error={summaryQuery.error}
        onRetry={() => void summaryQuery.refetch()}
      />
    )
  }

  const summary = summaryQuery.data
  if (!summary) return <RouteState message="Chargement du résumé de caisse…" />
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

  if (pendingLocalSalesQuery.isLoading) {
    return <RouteState message="Vérification des ventes en attente…" />
  }

  const pendingLocalSalesCount = pendingLocalSalesQuery.data ?? 0
  const cashContext = localSession?.storeName
    ? `${localSession.storeName} · ${summary.cash_register.name}`
    : summary.cash_register.name
  if (pendingLocalSalesCount > 0) {
    async function handleSyncClick() {
      setSyncResultMessage(null)
      const outcome = await triggerSync()
      void queryClient.invalidateQueries({ queryKey: pendingLocalSalesQueryKey })
      setSyncResultMessage(describeSyncOutcome(outcome))
    }

    return (
      <main className="operational-page operational-page-narrow">
        <OperationalPageHeader
          backTo="/pos"
          backLabel="Retour au point de vente"
          eyebrow="Fin de journée"
          title="Clôturer la caisse"
          context={cashContext}
        />
        <section className="operational-card closing-sheet" aria-label="Synchronisation avant clôture">

          <p className="form-error" role="alert">
            {pendingLocalSalesCount} vente{pendingLocalSalesCount > 1 ? "s" : ""} de cette
            session {pendingLocalSalesCount > 1 ? "n'ont" : "n'a"} pas encore été synchronisée
            {pendingLocalSalesCount > 1 ? "s" : ""} avec le serveur. Reconnectez-vous à Internet
            pour synchroniser avant de clôturer.
          </p>

          <button
            className="button button-primary"
            type="button"
            disabled={!isOnline || isSyncing}
            onClick={() => void handleSyncClick()}
          >
            {isSyncing ? "Synchronisation…" : "Synchroniser maintenant"}
          </button>
          {syncResultMessage ? (
            <p className="form-success" role="status">
              {syncResultMessage}
            </p>
          ) : null}
        </section>
      </main>
    )
  }

  return (
    <main className="operational-page operational-page-narrow">
      <OperationalPageHeader
        backTo="/pos"
        backLabel="Retour au point de vente"
        eyebrow="Fin de journée"
        title="Clôturer la caisse"
        context={cashContext}
      />
      <section className="operational-card closing-sheet" aria-label="Résumé de clôture">

        <div className="closing-identity">
          <strong>{summary.cash_register.name}</strong>
          <span>Caissier : {summary.cashier.username}</span>
          <span>Ouverte le {formatDateTime(summary.opened_at)}</span>
        </div>

        <dl className="closing-summary" aria-label="Résumé de la session">
          <div className="closing-summary-total">
            <dt>Nombre de ventes</dt>
            <dd>{summary.sales_count}</dd>
          </div>
          <div className="closing-summary-total">
            <dt>Chiffre d’affaires</dt>
            <dd>{formatBackendMoney(summary.gross_sales)}</dd>
          </div>
          <div>
            <dt>Espèces</dt>
            <dd>{formatBackendMoney(summary.payments.cash)}</dd>
          </div>
          <div>
            <dt>Wave</dt>
            <dd>{formatBackendMoney(summary.payments.wave)}</dd>
          </div>
          <div>
            <dt>Orange Money</dt>
            <dd>{formatBackendMoney(summary.payments.orange_money)}</dd>
          </div>
          <div className="closing-summary-opening">
            <dt>Fond initial</dt>
            <dd>{formatBackendMoney(summary.opening_balance)}</dd>
          </div>
        </dl>

        <p className="closing-instruction">
          Comptez l’argent présent dans le tiroir-caisse, puis saisissez le montant obtenu.
        </p>

        <form className="counted-cash-form" onSubmit={handleContinue}>
          <div className="counted-cash-field">
            <label htmlFor="counted-cash">Montant compté</label>
            <div className="money-input">
              <input
                id="counted-cash"
                autoFocus
                inputMode="numeric"
                placeholder="29 500"
                value={countedCash}
                disabled={closeMutation.isPending}
                aria-describedby="counted-cash-help"
                aria-invalid={hasCountedCash && parsedCountedCash === null}
                onChange={(event) => setCountedCash(event.target.value)}
              />
              <span>FCFA</span>
            </div>
            <small
              id="counted-cash-help"
              className={hasCountedCash && parsedCountedCash === null ? "field-error" : undefined}
            >
              {parsedCountedCash !== null
                ? formatMoney(parsedCountedCash)
                : hasCountedCash
                  ? "Saisissez un montant positif ou nul, sans décimales."
                  : "Montant entier, sans décimales"}
            </small>
          </div>

          <button
            className="button button-primary"
            type="submit"
            disabled={parsedCountedCash === null || closeMutation.isPending}
          >
            Continuer
          </button>
        </form>
      </section>

      {isConfirming ? (
        <Dialog
          eyebrow="Confirmation"
          title={`Clôturer ${summary.cash_register.name} ?`}
          className="closing-confirmation"
          dismissible={!closeMutation.isPending}
          onClose={() => {
            closeMutation.reset()
            setIsConfirming(false)
          }}
        >
          <div className="pos-dialog-body">
            <p>
              Montant compté : <strong>{formatMoney(parsedCountedCash!)}</strong>
            </p>
            <p className="confirmation-warning">
              Après cette opération, aucune nouvelle vente ne pourra être enregistrée sur cette
              session.
            </p>

            {closeMutation.error ? (
              <p className="form-error" role="alert">
                {closeMutation.error.message}
              </p>
            ) : null}

            <div className="confirmation-actions">
              <button
                className="button button-secondary"
                type="button"
                disabled={closeMutation.isPending}
                onClick={() => {
                  closeMutation.reset()
                  setIsConfirming(false)
                }}
              >
                Annuler
              </button>
              <button
                className="button button-close-session"
                type="button"
                disabled={closeMutation.isPending}
                onClick={() => closeMutation.mutate(parsedCountedCash!)}
              >
                {closeMutation.isPending ? "Clôture…" : "Confirmer la clôture"}
              </button>
            </div>
          </div>
        </Dialog>
      ) : null}
    </main>
  )
}
