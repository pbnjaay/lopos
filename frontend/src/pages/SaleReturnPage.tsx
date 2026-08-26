import { useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useNavigate, useParams } from "react-router-dom"

import { createSaleReturn, getSaleReceipt } from "../api/sales"
import { PageHeader } from "../components/layout/PageHeader"
import { Badge } from "../components/ui/Badge"
import { Button } from "../components/ui/Button"
import { Dialog, DialogBody, DialogFooter } from "../components/ui/Dialog"
import { InlineAlert } from "../components/ui/InlineAlert"
import { Money } from "../components/ui/Money"
import { QuantityControl } from "../components/ui/QuantityControl"
import { RouteError, RouteLoading } from "../components/ui/RouteState"
import { SectionHeader } from "../components/ui/SectionHeader"
import { useCurrentUser } from "../features/auth/queries"
import { usePosSession } from "../features/cash-session/queries"
import { useNetworkStatus } from "../features/offline/useNetworkStatus"
import type { PaymentMethod, SaleReceipt } from "../types/api"
import { describeErrorShort } from "../utils/errorCopy"
import { formatBackendMoney } from "../utils/money"
import { formatQuantity, milliToBackendQuantity, milliToDisplayQuantity, parseQuantityToMilli, backendQuantityToMilli, lineTotal } from "../utils/quantity"

const refundLabels: Record<PaymentMethod, string> = {
  CASH: "espèces",
  WAVE: "Wave",
  ORANGE_MONEY: "Orange Money",
}

export function SaleReturnPage() {
  const { saleId } = useParams<{ saleId: string }>()
  const user = useCurrentUser().data!
  const { ownSession } = usePosSession(user)
  const online = useNetworkStatus()
  const navigate = useNavigate()
  const confirmButtonRef = useRef<HTMLButtonElement>(null)
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
    ({ item, milli }) =>
      milli > backendQuantityToMilli(item.quantity_returnable ?? item.quantity) ||
      ((item.sale_unit ?? "UNIT") === "UNIT" && milli % 1000 !== 0),
  )

  function adjustQuantity(item: SaleReceipt["items"][number], direction: -1 | 1) {
    const saleUnit = item.sale_unit ?? "UNIT"
    const maximum = backendQuantityToMilli(item.quantity_returnable ?? item.quantity)
    const current = parseQuantityToMilli(quantities[item.id] ?? "") ?? 0
    const step = saleUnit === "KG" ? 100 : 1000
    const next = Math.max(0, Math.min(maximum, current + direction * step))
    setQuantities({ ...quantities, [item.id]: next === 0 ? "" : milliToDisplayQuantity(next) })
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
    } catch (caught) {
      setError(describeErrorShort(caught, "retour"))
    } finally {
      setSubmitting(false)
    }
  }

  if (!online) {
    return (
      <RouteError
        context="retour"
        title="Mode hors ligne"
        description="Un retour marchandise nécessite une connexion. Vous pouvez continuer à vendre."
      />
    )
  }
  if (saleQuery.isLoading) return <RouteLoading message="Chargement de la vente…" />
  if (saleQuery.error || !sale) {
    return (
      <RouteError error={saleQuery.error} context="retour" onRetry={() => void saleQuery.refetch()} />
    )
  }

  return <main className="operational-page">
  <PageHeader
    backTo={`/sales/${sale.id}`}
    backLabel="Retour à la vente"
    eyebrow="Retour marchandise"
    title={`Ticket ${sale.id.slice(0, 8).toUpperCase()}`}
    context={`${sale.store.name} · ${sale.cash_register.name}`}
  />
  <section className="operational-card return-sheet">
    <div className="card-section">
      <SectionHeader
        title="Articles à retourner"
        description="Saisissez uniquement les quantités réellement rapportées par le client."
      />

      <div className="return-workspace">
      <div className="return-items">
        {sale.items.map((item) => {
        const saleUnit = item.sale_unit ?? "UNIT"
        const returnableMilli = backendQuantityToMilli(item.quantity_returnable ?? item.quantity)
        const enteredMilli = parseQuantityToMilli(quantities[item.id] ?? "")
        const isUnavailable = returnableMilli <= 0
        return <article className={`return-item${isUnavailable ? " return-item-disabled" : ""}`} key={item.id}>
          <header>
            <div><strong>{item.product_name}</strong><span>Acheté : {formatQuantity(backendQuantityToMilli(item.quantity), saleUnit)}</span></div>
            <Badge tone={isUnavailable ? "neutral" : "accent"}>
              {isUnavailable ? "Entièrement retourné" : `${formatQuantity(returnableMilli, saleUnit)} disponible${saleUnit === "UNIT" && returnableMilli > 1000 ? "s" : ""}`}
            </Badge>
          </header>
          <div className="return-item-controls">
            <div className="field">
              <label htmlFor={`return-quantity-${item.id}`}>Quantité à retourner</label>
              <QuantityControl
                valueMilli={enteredMilli}
                saleUnit={saleUnit}
                maximumMilli={returnableMilli}
                disabled={isUnavailable}
                inputId={`return-quantity-${item.id}`}
                quantityLabel="Quantité à retourner"
                decreaseLabel={`Diminuer la quantité de ${item.product_name}`}
                increaseLabel={`Augmenter la quantité de ${item.product_name}`}
                onDecrease={() => adjustQuantity(item, -1)}
                onIncrease={() => adjustQuantity(item, 1)}
                onCommit={(value) => setQuantities({ ...quantities, [item.id]: milliToDisplayQuantity(value) })}
              />
            </div>
            <label className="return-restock-field">
              <input type="checkbox" checked={restocks[item.id] ?? true} disabled={isUnavailable} onChange={(event) => setRestocks({ ...restocks, [item.id]: event.target.checked })} />
              <span className="return-restock-switch" aria-hidden="true" />
              <span><strong>Remettre en stock</strong><small>Le produit peut être revendu.</small></span>
            </label>
          </div>
        </article>
        })}
      </div>
      <aside className="return-summary" aria-label="Résumé du remboursement">
        <SectionHeader eyebrow="Remboursement" title="Résumé du retour" />
        <div className="return-selection-count"><span>Articles sélectionnés</span><strong>{selected.length}</strong></div>
        <div className="field">
          <label htmlFor="return-payment-method">Mode de remboursement</label>
          <select id="return-payment-method" value={method} onChange={(event) => setMethod(event.target.value as PaymentMethod)}>
            <option value="CASH">Espèces</option>
            <option value="WAVE">Wave</option>
            <option value="ORANGE_MONEY">Orange Money</option>
          </select>
        </div>
        <div className="return-total">
          <span>Montant à rembourser</span>
          <strong><Money value={total} /></strong>
        </div>
        <Button
          variant="primary"
          size="lg"
          block
          disabled={selected.length === 0 || hasInvalidQuantity || submitting}
          onClick={() => setIsConfirming(true)}
        >
          Rembourser {formatBackendMoney(`${total}.00`)}
        </Button>
        {error && !isConfirming ? <InlineAlert tone="error">{error}</InlineAlert> : null}
        </aside>
      </div>
    </div>
  </section>
  {isConfirming ? (
    <Dialog
      eyebrow="Retour marchandise"
      title="Confirmer le remboursement ?"
      size="sm"
      dismissible={!submitting}
      // Confirmation non destructive : le focus va sur l'action primaire,
      // donc Entrée confirme sans quitter le clavier.
      initialFocusRef={confirmButtonRef}
      onClose={() => setIsConfirming(false)}
    >
      <DialogBody>
        <p>
          Vous allez rembourser <strong>{formatBackendMoney(`${total}.00`)}</strong> par{" "}
          {refundLabels[method]}.
        </p>
        <p className="dialog-hint">Les quantités sélectionnées seront enregistrées comme retournées.</p>
        {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
        <DialogFooter>
          <Button variant="secondary" disabled={submitting} onClick={() => setIsConfirming(false)}>
            Annuler
          </Button>
          <Button
            ref={confirmButtonRef}
            variant="primary"
            loading={submitting}
            loadingLabel="Enregistrement…"
            onClick={() => void submit()}
          >
            Rembourser {formatBackendMoney(`${total}.00`)}
          </Button>
        </DialogFooter>
      </DialogBody>
    </Dialog>
  ) : null}
  </main>
}
