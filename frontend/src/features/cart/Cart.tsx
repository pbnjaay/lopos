import { formatMoney } from "../../utils/money"
import type { CartItem } from "./cartState"
import { formatQuantity, lineTotal, parseQuantityToMilli } from "../../utils/quantity"

type CartProps = {
  items: CartItem[]
  total: number
  onIncrement: (productId: string) => void
  onDecrement: (productId: string) => void
  onQuantityChange: (productId: string, quantityMilli: number) => void
  onPriceChange: (productId: string, unitPrice: number) => void
  onRemove: (productId: string) => void
  onClear: () => void
  onCheckout: () => void
}

export function Cart({
  items,
  total,
  onIncrement,
  onDecrement,
  onQuantityChange,
  onPriceChange,
  onRemove,
  onClear,
  onCheckout,
}: CartProps) {
  return (
    <section className="cart-panel" aria-labelledby="cart-title">
      <header className="cart-header">
        <div>
          <p className="eyebrow">Vente en cours</p>
          <h2 id="cart-title">Panier</h2>
        </div>
        {items.length > 0 ? (
          <button className="text-button" type="button" onClick={onClear}>
            Vider
          </button>
        ) : null}
      </header>

      {items.length === 0 ? (
        <div className="empty-cart">
          <strong>Panier vide</strong>
          <span>Ajoutez un produit depuis la recherche.</span>
        </div>
      ) : (
        <ul className="cart-list">
          {items.map((item) => (
            <li key={item.productId} className="cart-item">
              <div className="cart-item-heading">
                <div>
                  <strong>{item.name}</strong>
                  <span>
                    {formatQuantity(item.quantityMilli ?? (item.quantity ?? 0) * 1000, item.saleUnit ?? "UNIT")} × {formatMoney(item.unitPrice)}{item.saleUnit === "KG" ? "/kg" : ""}
                  </span>
                </div>
                <strong>{formatMoney(lineTotal(item.unitPrice, item.quantityMilli ?? (item.quantity ?? 0) * 1000))}</strong>
              </div>

              <div className="cart-item-actions">
                <div
                  className="quantity-control"
                  role="group"
                  aria-label={`Contrôles de quantité pour ${item.name}`}
                >
                  <button
                    type="button"
                    aria-label={`Diminuer ${item.name}`}
                    disabled={(item.quantityMilli ?? (item.quantity ?? 0) * 1000) <= (item.saleUnit === "KG" ? 100 : 1000)}
                    onClick={() => onDecrement(item.productId)}
                  >
                    −
                  </button>
                  <input
                    type="number"
                    inputMode="decimal"
                    min={item.saleUnit === "UNIT" ? 1 : 0.001}
                    step={item.saleUnit === "UNIT" ? 1 : 0.001}
                    value={(item.quantityMilli ?? (item.quantity ?? 0) * 1000) / 1000}
                    aria-label={`Quantité de ${item.name}`}
                    onChange={(event) => {
                      const quantity = parseQuantityToMilli(event.currentTarget.value)
                      if (quantity !== null && (item.saleUnit === "KG" || quantity % 1000 === 0)) onQuantityChange(item.productId, quantity)
                    }}
                  />
                  <button
                    type="button"
                    aria-label={`Augmenter ${item.name}`}
                    disabled={(item.quantityMilli ?? (item.quantity ?? 0) * 1000) >= (item.stockMilli ?? (item.stock ?? 0) * 1000)}
                    onClick={() => onIncrement(item.productId)}
                  >
                    +
                  </button>
                </div>
                <button className="text-button" type="button" onClick={() => {
                  const raw = window.prompt(`Prix catalogue : ${formatMoney(item.catalogUnitPrice ?? item.unitPrice)}\nPrix pour cette vente`, String(item.unitPrice))
                  if (raw && /^\d+$/.test(raw) && Number(raw) > 0) onPriceChange(item.productId, Number(raw))
                }}>
                  Modifier le prix
                </button>
                <button
                  className="text-button danger-button"
                  type="button"
                  aria-label={`Supprimer ${item.name}`}
                  onClick={() => onRemove(item.productId)}
                >
                  Supprimer
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <footer className="cart-summary">
        <div>
          <span>Total</span>
          <strong>{formatMoney(total)}</strong>
        </div>
        <div className="checkout-button-group">
          <button
            className="button button-primary checkout-button"
            type="button"
            disabled={items.length === 0}
            onClick={onCheckout}
          >
            Encaisser
          </button>
          {items.length > 0 ? (
            <p className="checkout-shortcuts-hint">F1 Espèces · F2 Wave · F3 Orange Money</p>
          ) : null}
        </div>
      </footer>
    </section>
  )
}
