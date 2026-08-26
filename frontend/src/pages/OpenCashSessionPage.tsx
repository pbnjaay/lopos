import { type FormEvent, useEffect, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "react-router-dom"

import { getCurrentCashSession } from "../api/cashRegisters"
import { openCashSession } from "../api/cashSessions"
import { getStores } from "../api/stores"
import { trackCashSessionOpened } from "../analytics/events"
import { Button } from "../components/ui/Button"
import { InlineAlert } from "../components/ui/InlineAlert"
import { Skeleton } from "../components/ui/Skeleton"
import { saveLocalCashSession } from "../db/sessions"
import { useCurrentUser } from "../features/auth/queries"
import { storeCashRegisterId, usePosSession } from "../features/cash-session/queries"
import { describeErrorShort } from "../utils/errorCopy"
import { formatMoney, parseMoneyInput, toBackendMoney } from "../utils/money"

export function OpenCashSessionPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const user = useCurrentUser().data!
  const { registers, ownSession } = usePosSession(user)
  const storesQuery = useQuery({
    queryKey: ["stores"],
    queryFn: getStores,
    staleTime: 30_000,
  })
  const activeStores = (storesQuery.data ?? []).filter((store) => store.is_active)
  const activeRegisters = registers.filter((register) => register.is_active)
  const [storeId, setStoreId] = useState("")
  const [cashRegisterId, setCashRegisterId] = useState("")
  const [openingBalance, setOpeningBalance] = useState("")
  const [fieldError, setFieldError] = useState<string | null>(null)
  const storeRegisters = activeRegisters.filter((register) => register.store_id === storeId)
  const selectedStore = activeStores.find((store) => store.id === storeId) ?? null
  const selected = storeRegisters.find((register) => register.id === cashRegisterId) ?? null
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
    onSuccess: async (session) => {
      storeCashRegisterId(session.cash_register_id)
      const openedRegister = activeRegisters.find(
        (register) => register.id === session.cash_register_id,
      )
      if (openedRegister) {
        try {
          await saveLocalCashSession(session, openedRegister, user)
        } catch {
          // The server session is already open; keep the online flow usable.
        }
      }
      queryClient.setQueryData(
        ["cash-registers", session.cash_register_id, "current-session"],
        session,
      )
      // La lecture Dexie de la session locale est cachée avec staleTime
      // Infinity : sans invalidation, elle resterait figée sur l'état
      // d'avant l'ouverture pour toute la vie du SPA.
      void queryClient.invalidateQueries({ queryKey: ["local-cash-session"] })
      trackCashSessionOpened({
        cash_session_id: session.id,
        store_id: openedRegister?.store_id ?? null,
        cash_register_id: session.cash_register_id,
      })
      navigate("/pos", { replace: true })
    },
    onError: () => {
      void sessionQuery.refetch()
    },
  })

  useEffect(() => {
    const registerId = ownSession?.cash_register_id ?? (
      selected && sessionOwnedByUser ? selected.id : null
    )
    if (!registerId) return
    storeCashRegisterId(registerId)
    navigate("/pos", { replace: true })
  }, [navigate, ownSession, selected, sessionOwnedByUser])

  function handleStoreChange(nextId: string) {
    setStoreId(nextId)
    setCashRegisterId("")
    setFieldError(null)
    openingMutation.reset()
  }

  function handleRegisterChange(nextId: string) {
    setCashRegisterId(nextId)
    setFieldError(null)
    openingMutation.reset()
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

    if (!storeId) {
      setFieldError("Sélectionnez une boutique.")
      return
    }
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
        <p className="metadata">Choisissez votre boutique, puis la caisse et son fond initial.</p>

        {storesQuery.isLoading ? (
          <div className="form-stack" role="status" aria-live="polite">
            <span className="visually-hidden">Chargement des boutiques autorisées…</span>
            <Skeleton height="var(--control-md)" />
            <Skeleton height="var(--control-md)" />
            <Skeleton height="var(--control-md)" />
          </div>
        ) : storesQuery.error ? (
          <InlineAlert
            tone="error"
            title="Impossible de charger vos boutiques"
            className="setup-alert"
            action={
              <Button variant="secondary" size="sm" onClick={() => void storesQuery.refetch()}>
                Réessayer
              </Button>
            }
          >
            {describeErrorShort(storesQuery.error, "session")}
          </InlineAlert>
        ) : activeStores.length === 0 ? (
          <InlineAlert tone="warning" assertive title="Aucune boutique affectée" className="setup-alert">
            Contactez un administrateur pour rattacher votre compte à une boutique.
          </InlineAlert>
        ) : (
          <form className="form-stack" onSubmit={handleSubmit}>
            <label className="field">
              <span className="field-label">Boutique</span>
              <select
                autoFocus
                value={storeId}
                disabled={openingMutation.isPending}
                onChange={(event) => handleStoreChange(event.target.value)}
              >
                <option value="">Sélectionner une boutique</option>
                {activeStores.map((store) => (
                  <option key={store.id} value={store.id}>{store.name}</option>
                ))}
              </select>
            </label>

            <label className="field">
              <span className="field-label">Caisse</span>
              <select
                value={cashRegisterId}
                disabled={openingMutation.isPending || !storeId}
                onChange={(event) => handleRegisterChange(event.target.value)}
              >
                <option value="">Sélectionner une caisse</option>
                {storeRegisters.map((register) => (
                  <option key={register.id} value={register.id}>
                    {register.name}
                  </option>
                ))}
              </select>
            </label>

            {storeId && storeRegisters.length === 0 ? (
              <InlineAlert tone="warning" assertive>
                Aucune caisse active n’est disponible dans cette boutique.
              </InlineAlert>
            ) : null}

            <div className="field">
              <label htmlFor="opening-balance">Fond de caisse initial</label>
              <div className="money-input">
                <input
                  id="opening-balance"
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

            {sessionQuery.isFetching ? (
              <p className="metadata" role="status">Vérification de la caisse…</p>
            ) : null}
            {occupiedByAnotherCashier ? (
              <InlineAlert tone="warning" assertive title="Caisse déjà ouverte">
                Un autre caissier a une session en cours sur cette caisse. Choisissez-en une autre.
              </InlineAlert>
            ) : null}
            {fieldError || openingMutation.error || sessionQuery.error ? (
              <InlineAlert tone="error">
                {fieldError ??
                  describeErrorShort(openingMutation.error ?? sessionQuery.error, "session")}
              </InlineAlert>
            ) : null}

            {selectedStore && selected && parsedOpeningBalance !== null ? (
              <div className="opening-review" aria-label="Récapitulatif de l’ouverture">
                <span>Vous allez ouvrir</span>
                <strong>{selectedStore.name} · {selected.name}</strong>
                <span>Fond initial : {formatMoney(parsedOpeningBalance)}</span>
              </div>
            ) : null}

            <Button
              variant="primary"
              type="submit"
              block
              loading={openingMutation.isPending}
              loadingLabel="Ouverture…"
              disabled={
                sessionQuery.isFetching ||
                occupiedByAnotherCashier ||
                !cashRegisterId ||
                parsedOpeningBalance === null
              }
            >
              {selected ? `Ouvrir ${selected.name}` : "Ouvrir la caisse"}
            </Button>
          </form>
        )}
      </section>
    </main>
  )
}
