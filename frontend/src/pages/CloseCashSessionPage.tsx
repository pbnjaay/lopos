import { type FormEvent, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, useNavigate } from "react-router-dom"

import { closeCashSession, getCashSessionSummary } from "../api/cashSessions"
import { RouteState } from "../components/ui/RouteState"
import { useCurrentUser } from "../features/auth/queries"
import { CashClosingResult } from "../features/cash-session/CashClosingResult"
import { usePosSession } from "../features/cash-session/queries"
import { formatDateTime } from "../utils/date"
import {
  formatBackendMoney,
  formatMoney,
  parseMoneyInput,
  toBackendMoney,
} from "../utils/money"

export function CloseCashSessionPage() {
  const user = useCurrentUser().data!
  const { ownSession } = usePosSession(user.id)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [countedCash, setCountedCash] = useState("")
  const [isConfirming, setIsConfirming] = useState(false)
  const parsedCountedCash = parseMoneyInput(countedCash)
  const hasCountedCash = countedCash.trim().length > 0
  const summaryQuery = useQuery({
    queryKey: ["cash-sessions", ownSession?.id, "summary"],
    queryFn: () => getCashSessionSummary(ownSession!.id),
    enabled: ownSession !== null,
  })
  const closeMutation = useMutation({
    mutationFn: (amount: number) =>
      closeCashSession(ownSession!.id, { counted_cash: toBackendMoney(amount) }),
    onSuccess: (closedSummary) => {
      setIsConfirming(false)
      queryClient.setQueryData(
        ["cash-sessions", closedSummary.id, "summary"],
        closedSummary,
      )
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

  if (closeMutation.data) {
    return (
      <CashClosingResult
        summary={closeMutation.data}
        onFinish={() => {
          queryClient.setQueryData(
            ["cash-registers", ownSession.cash_register_id, "current-session"],
            null,
          )
          navigate("/cash/open", { replace: true })
        }}
      />
    )
  }

  return (
    <main className="closing-page">
      <section className="closing-sheet" aria-labelledby="close-session-title">
        <header className="closing-heading">
          <div>
            <p className="eyebrow">Fin de journée</p>
            <h1 id="close-session-title">Clôturer la caisse</h1>
          </div>
          <Link className="text-button close-session-back-link" to="/pos">
            Retour au point de vente
          </Link>
        </header>

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
        <div className="modal-backdrop">
          <section
            className="checkout-modal closing-confirmation"
            role="dialog"
            aria-modal="true"
            aria-labelledby="closing-confirmation-title"
          >
            <p className="eyebrow">Confirmation</p>
            <h2 id="closing-confirmation-title">Clôturer {summary.cash_register.name} ?</h2>
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
          </section>
        </div>
      ) : null}
    </main>
  )
}
