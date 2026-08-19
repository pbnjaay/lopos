import { formatMoney } from "../../utils/money"
import type { CartItem } from "./cartState"

type CartProps = {
  items: CartItem[]
  total: number
  onIncrement: (productId: string) => void
  onDecrement: (productId: string) => void
  onQuantityChange: (productId: string, quantity: number) => void
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
                  <span>{formatMoney(item.unitPrice)} l’unité</span>
                </div>
                <strong>{formatMoney(item.unitPrice * item.quantity)}</strong>
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
                    disabled={item.quantity <= 1}
                    onClick={() => onDecrement(item.productId)}
                  >
                    −
                  </button>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={item.stock}
                    value={item.quantity}
                    aria-label={`Quantité de ${item.name}`}
                    onChange={(event) => {
                      const quantity = event.currentTarget.valueAsNumber
                      if (Number.isInteger(quantity)) {
                        onQuantityChange(item.productId, quantity)
                      }
                    }}
                  />
                  <button
                    type="button"
                    aria-label={`Augmenter ${item.name}`}
                    disabled={item.quantity >= item.stock}
                    onClick={() => onIncrement(item.productId)}
                  >
                    +
                  </button>
                </div>
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
