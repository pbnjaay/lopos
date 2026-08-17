import { type FormEvent, useEffect, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "react-router-dom"

import { getCurrentCashSession } from "../api/cashRegisters"
import { openCashSession } from "../api/cashSessions"
import { useCurrentUser } from "../features/auth/queries"
import { storeCashRegisterId, usePosSession } from "../features/cash-session/queries"
import { formatMoney, parseMoneyInput, toBackendMoney } from "../utils/money"

export function OpenCashSessionPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const user = useCurrentUser().data!
  const { registers, selectedRegister } = usePosSession(user.id)
  const activeRegisters = registers.filter((register) => register.is_active)
  const [cashRegisterId, setCashRegisterId] = useState(selectedRegister?.id ?? "")
  const [openingBalance, setOpeningBalance] = useState("")
  const [fieldError, setFieldError] = useState<string | null>(null)
  const selected = activeRegisters.find((register) => register.id === cashRegisterId) ?? null
  const sessionQuery = useQuery({
    queryKey: ["cash-registers", selected?.id, "current-session"],
    queryFn: () => getCurrentCashSession(selected!.id),
    enabled: selected !== null,
    retry: false,
  })
  const currentSession = sessionQuery.data ?? null
  const sessionOwnedByUser = currentSession?.cashier_id === user.id
  const occupiedByAnotherCashier = currentSession !== null && !sessionOwnedByUser
  const openingMutation = useMutation({
    mutationFn: openCashSession,
    onSuccess: (session) => {
      storeCashRegisterId(session.cash_register_id)
      queryClient.setQueryData(
        ["cash-registers", session.cash_register_id, "current-session"],
        session,
      )
      navigate("/pos", { replace: true })
    },
    onError: () => {
      void sessionQuery.refetch()
    },
  })

  useEffect(() => {
    if (!selected || !sessionOwnedByUser) return
    storeCashRegisterId(selected.id)
    navigate("/pos", { replace: true })
  }, [navigate, selected, sessionOwnedByUser])

  function handleRegisterChange(nextId: string) {
    setCashRegisterId(nextId)
    setFieldError(null)
    openingMutation.reset()
    if (nextId) storeCashRegisterId(nextId)
  }

  function handleBalanceChange(value: string) {
    if (!/^[\d\s]*$/.test(value)) return
    setOpeningBalance(value)
    setFieldError(null)
    openingMutation.reset()
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const amount = parseMoneyInput(openingBalance)

    if (!cashRegisterId) {
      setFieldError("Sélectionnez une caisse.")
      return
    }
    if (amount === null) {
      setFieldError("Saisissez un fond de caisse positif ou nul en FCFA.")
      return
    }

    openingMutation.mutate({
      cash_register_id: cashRegisterId,
      opening_balance: toBackendMoney(amount),
    })
  }

  const parsedOpeningBalance = parseMoneyInput(openingBalance)

  return (
    <main className="content-page">
      <section className="setup-card" aria-labelledby="open-session-title">
        <p className="eyebrow">Session de caisse</p>
        <h1 id="open-session-title">Ouvrir la caisse</h1>
        <p className="muted">Choisissez la caisse et indiquez son fond initial.</p>

        {activeRegisters.length === 0 ? (
          <p className="form-error" role="alert">
            Aucune caisse active n’est disponible. Contactez un administrateur.
          </p>
        ) : (
          <form className="form-stack" onSubmit={handleSubmit}>
            <label className="field">
              <span>Caisse</span>
              <select
                value={cashRegisterId}
                disabled={openingMutation.isPending}
                onChange={(event) => handleRegisterChange(event.target.value)}
              >
                <option value="">Sélectionner une caisse</option>
                {activeRegisters.map((register) => (
                  <option key={register.id} value={register.id}>
                    {register.name}
                  </option>
                ))}
              </select>
            </label>

            <div className="field">
              <label htmlFor="opening-balance">Fond de caisse initial</label>
              <div className="money-input">
                <input
                  id="opening-balance"
                  autoFocus={activeRegisters.length === 1}
                  inputMode="numeric"
                  placeholder="15 000"
                  value={openingBalance}
                  disabled={openingMutation.isPending || !cashRegisterId}
                  aria-describedby="opening-balance-help"
                  onChange={(event) => handleBalanceChange(event.target.value)}
                />
                <span>FCFA</span>
              </div>
              <small id="opening-balance-help">
                {parsedOpeningBalance === null
                  ? "Montant entier, sans décimales"
                  : formatMoney(parsedOpeningBalance)}
              </small>
            </div>

            {sessionQuery.isFetching ? <p className="muted">Vérification de la caisse…</p> : null}
            {occupiedByAnotherCashier ? (
              <p className="form-error" role="alert">
                Cette caisse possède déjà une session ouverte par un autre caissier.
              </p>
            ) : null}
            {fieldError || openingMutation.error || sessionQuery.error ? (
              <p className="form-error" role="alert">
                {fieldError ?? openingMutation.error?.message ?? sessionQuery.error?.message}
              </p>
            ) : null}

            <button
              className="button button-primary"
              type="submit"
              disabled={
                openingMutation.isPending ||
                sessionQuery.isFetching ||
                occupiedByAnotherCashier ||
                !cashRegisterId ||
                parsedOpeningBalance === null
              }
            >
              {openingMutation.isPending ? "Ouverture…" : "Ouvrir la caisse"}
            </button>
          </form>
        )}
      </section>
    </main>
  )
}
