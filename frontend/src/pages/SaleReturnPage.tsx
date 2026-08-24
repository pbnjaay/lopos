import { useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { createSaleReturn, getSaleReceipt } from "../api/sales"
import { Dialog } from "../components/ui/Dialog"
import { useCurrentUser } from "../features/auth/queries"
import { usePosSession } from "../features/cash-session/queries"
import { useNetworkStatus } from "../features/offline/useNetworkStatus"
import type { PaymentMethod, SaleReceipt } from "../types/api"
import { formatBackendMoney } from "../utils/money"
import { formatQuantity, milliToBackendQuantity, parseQuantityToMilli, backendQuantityToMilli, lineTotal } from "../utils/quantity"

export function SaleReturnPage() {
  const user = useCurrentUser().data!
  const { ownSession } = usePosSession(user)
  const online = useNetworkStatus()
  const navigate = useNavigate()
  const [reference, setReference] = useState("")
  const [sale, setSale] = useState<SaleReceipt | null>(null)
  const [quantities, setQuantities] = useState<Record<string, string>>({})
  const [restocks, setRestocks] = useState<Record<string, boolean>>({})
  const [method, setMethod] = useState<PaymentMethod>("CASH")
  const [error, setError] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [isConfirming, setIsConfirming] = useState(false)

  const selected = sale?.items.flatMap((item) => {
    const milli = parseQuantityToMilli(quantities[item.id] ?? "")
    if (!milli) return []
    return [{ item, milli, amount: lineTotal(Math.round(Number(item.unit_price)), milli) }]
  }) ?? []
  const total = selected.reduce((sum, row) => sum + row.amount, 0)

  async function findSale() {
    if (!online) { setError("Retour indisponible hors connexion. Reconnectez-vous pour effectuer un retour."); return }
    setError("")
    try { setSale(await getSaleReceipt(reference.trim())) } catch (caught) { setError(caught instanceof Error ? caught.message : "Vente introuvable.") }
  }

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

  return <main className="closing-page"><section className="closing-sheet">
    <Link className="text-button" to="/pos">Retour au POS</Link>
    <p className="eyebrow">Opération en ligne</p><h1>Retour marchandise</h1>
    {!online ? <p className="form-error">Retour indisponible hors connexion. Reconnectez-vous.</p> : null}
    <div className="form-field"><label htmlFor="sale-reference">Référence de vente</label><input id="sale-reference" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="UUID du ticket" /></div>
    <button className="button button-secondary" type="button" disabled={!online || !reference.trim()} onClick={() => void findSale()}>Rechercher la vente</button>
    {sale ? <>
      <h2>Vente {sale.id.slice(0, 8).toUpperCase()}</h2>
      {sale.items.map((item) => <div className="cart-item" key={item.id}>
        <strong>{item.product_name}</strong>
        <span>Vendu : {formatQuantity(backendQuantityToMilli(item.quantity), item.sale_unit ?? "UNIT")} · Retournable : {formatQuantity(backendQuantityToMilli(item.quantity_returnable ?? item.quantity), item.sale_unit ?? "UNIT")}</span>
        <label>Quantité à retourner <input inputMode="decimal" placeholder={item.sale_unit === "KG" ? "0,300" : "1"} value={quantities[item.id] ?? ""} onChange={(e) => setQuantities({ ...quantities, [item.id]: e.target.value })} /></label>
        <label><input type="checkbox" checked={restocks[item.id] ?? true} onChange={(e) => setRestocks({ ...restocks, [item.id]: e.target.checked })} /> Remettre en stock</label>
      </div>)}
      <div className="form-field"><label>Mode de remboursement</label><select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}><option value="CASH">Espèces</option><option value="WAVE">Wave</option><option value="ORANGE_MONEY">Orange Money</option></select></div>
      <p><strong>Montant à rembourser : {formatBackendMoney(`${total}.00`)}</strong></p>
      <button className="button button-primary" type="button" disabled={submitting || selected.length === 0} onClick={() => setIsConfirming(true)}>CONFIRMER LE RETOUR</button>
    </> : null}
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
