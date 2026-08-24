import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useNavigate, useParams } from "react-router-dom"
import { createSaleReturn, getSaleReceipt } from "../api/sales"
import { OperationalPageHeader } from "../components/layout/OperationalPageHeader"
import { Dialog } from "../components/ui/Dialog"
import { RouteState } from "../components/ui/RouteState"
import { useCurrentUser } from "../features/auth/queries"
import { usePosSession } from "../features/cash-session/queries"
import { useNetworkStatus } from "../features/offline/useNetworkStatus"
import type { PaymentMethod, SaleReceipt } from "../types/api"
import { formatBackendMoney } from "../utils/money"
import { formatQuantity, milliToBackendQuantity, parseQuantityToMilli, backendQuantityToMilli, lineTotal } from "../utils/quantity"

export function SaleReturnPage() {
  const { saleId } = useParams<{ saleId: string }>()
  const user = useCurrentUser().data!
  const { ownSession } = usePosSession(user)
  const online = useNetworkStatus()
  const navigate = useNavigate()
  const [quantities, setQuantities] = useState<Record<string, string>>({})
  const [restocks, setRestocks] = useState<Record<string, boolean>>({})
  const [method, setMethod] = useState<PaymentMethod>("CASH")
  const [error, setError] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [isConfirming, setIsConfirming] = useState(false)
  const saleQuery = useQuery({
    queryKey: ["sales", saleId, ownSession?.id, "return"],
    queryFn: () => getSaleReceipt(saleId!, ownSession!.id),
    enabled: Boolean(saleId && ownSession && online),
    retry: false,
  })
  const sale: SaleReceipt | null = saleQuery.data ?? null

  const selected = sale?.items.flatMap((item) => {
    const milli = parseQuantityToMilli(quantities[item.id] ?? "")
    if (!milli) return []
    return [{ item, milli, amount: lineTotal(Math.round(Number(item.unit_price)), milli) }]
  }) ?? []
  const total = selected.reduce((sum, row) => sum + row.amount, 0)
  const hasInvalidQuantity = selected.some(
    ({ item, milli }) => milli > backendQuantityToMilli(item.quantity_returnable ?? item.quantity),
  )

  async function submit() {
    if (!sale || !ownSession || selected.length === 0) return
    setSubmitting(true); setError("")
    try {
      const result = await createSaleReturn({
        sale_id: sale.id, cash_session_id: ownSession.id,
        idempotency_key: crypto.randomUUID(), payment_method: method,
        items: selected.map(({ item, milli }) => ({ sale_item_id: item.id, quantity: milliToBackendQuantity(milli), restock: restocks[item.id] ?? true })),
      })
      navigate(`/returns/${result.id}/receipt`)
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Retour impossible.") } finally { setSubmitting(false) }
  }

  if (!online) return <RouteState message="Retour indisponible hors connexion. Reconnectez-vous pour effectuer un retour." />
  if (saleQuery.isLoading) return <RouteState message="Chargement de la vente…" />
  if (saleQuery.error || !sale) return <RouteState message="Vente introuvable dans cette boutique." error={saleQuery.error} onRetry={() => void saleQuery.refetch()} />

  return <main className="operational-page operational-page-narrow">
  <OperationalPageHeader
    backTo={`/sales/${sale.id}`}
    backLabel="Retour à la vente"
    eyebrow="Retour marchandise"
    title={`Ticket ${sale.id.slice(0, 8).toUpperCase()}`}
    context={`${sale.store.name} · ${sale.cash_register.name}`}
  />
  <section className="operational-card return-sheet">
    <div className="section-introduction">
      <h2>Articles à retourner</h2>
      <p>Saisissez uniquement les quantités réellement rapportées par le client.</p>
    </div>

    <div className="return-items">
      {sale.items.map((item) => {
        const saleUnit = item.sale_unit ?? "UNIT"
        const returnableMilli = backendQuantityToMilli(item.quantity_returnable ?? item.quantity)
        const enteredMilli = parseQuantityToMilli(quantities[item.id] ?? "")
        const isUnavailable = returnableMilli <= 0
        const isInvalid = enteredMilli !== null && enteredMilli > returnableMilli
        return <article className={`return-item${isUnavailable ? " return-item-disabled" : ""}`} key={item.id}>
          <header>
            <div><strong>{item.product_name}</strong><span>Vendu : {formatQuantity(backendQuantityToMilli(item.quantity), saleUnit)}</span></div>
            <span className="returnable-badge">{isUnavailable ? "Déjà retourné" : `Retournable : ${formatQuantity(returnableMilli, saleUnit)}`}</span>
          </header>
          <div className="return-item-controls">
            <div className="form-field">
              <label htmlFor={`return-quantity-${item.id}`}>Quantité à retourner</label>
              <input
                id={`return-quantity-${item.id}`}
                inputMode="decimal"
                placeholder={saleUnit === "KG" ? "0,300" : "1"}
                value={quantities[item.id] ?? ""}
                disabled={isUnavailable}
                aria-invalid={isInvalid}
                onChange={(event) => setQuantities({ ...quantities, [item.id]: event.target.value })}
              />
              {isInvalid ? <small className="field-error">La quantité dépasse le maximum retournable.</small> : null}
            </div>
            <label className="checkbox-field">
              <input type="checkbox" checked={restocks[item.id] ?? true} disabled={isUnavailable} onChange={(event) => setRestocks({ ...restocks, [item.id]: event.target.checked })} />
              <span><strong>Remettre en stock</strong><small>Le produit est en état d’être revendu.</small></span>
            </label>
          </div>
        </article>
      })}
    </div>

    <div className="return-summary">
      <div className="form-field">
        <label htmlFor="return-payment-method">Mode de remboursement</label>
        <select id="return-payment-method" value={method} onChange={(event) => setMethod(event.target.value as PaymentMethod)}>
          <option value="CASH">Espèces</option>
          <option value="WAVE">Wave</option>
          <option value="ORANGE_MONEY">Orange Money</option>
        </select>
      </div>
      <div className="return-total"><span>Montant à rembourser</span><strong>{formatBackendMoney(`${total}.00`)}</strong></div>
      <button className="button button-primary return-submit" type="button" disabled={submitting || selected.length === 0 || hasInvalidQuantity} onClick={() => setIsConfirming(true)}>Continuer</button>
    </div>
    {error && !isConfirming ? <p className="form-error" role="alert">{error}</p> : null}
  </section>
  {isConfirming ? (
    <Dialog
      eyebrow="Retour marchandise"
      title="Confirmer le retour ?"
      dismissible={!submitting}
      onClose={() => setIsConfirming(false)}
    >
      <div className="pos-dialog-body">
        <p>Vous allez rembourser <strong>{formatBackendMoney(`${total}.00`)}</strong> par {{ CASH: "espèces", WAVE: "Wave", ORANGE_MONEY: "Orange Money" }[method]}.</p>
        <p className="muted">Les quantités sélectionnées seront enregistrées comme retournées.</p>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="modal-actions">
          <button className="button button-secondary" type="button" disabled={submitting} onClick={() => setIsConfirming(false)}>Annuler</button>
          <button className="button button-primary" type="button" disabled={submitting} onClick={() => void submit()}>{submitting ? "Traitement…" : "Confirmer le retour"}</button>
        </div>
      </div>
    </Dialog>
  ) : null}
  </main>
}
