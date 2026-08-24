import { useEffect, useState } from "react"

import { CartIcon, PencilIcon, TrashIcon, XIcon } from "../../components/ui/Icons"
import { Dialog } from "../../components/ui/Dialog"
import { QuantityControl } from "../../components/ui/QuantityControl"
import { formatMoney } from "../../utils/money"
import type { CartItem } from "./cartState"
import { formatQuantity, lineTotal } from "../../utils/quantity"
import { PriceDialog } from "./CartDialogs"

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
  onDialogOpenChange?: (isOpen: boolean) => void
  onInteractionComplete?: () => void
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
  onDialogOpenChange,
  onInteractionComplete,
}: CartProps) {
  const [editingQuantityProductId, setEditingQuantityProductId] = useState<string | null>(null)
  const [priceProductId, setPriceProductId] = useState<string | null>(null)
  const [isClearConfirming, setIsClearConfirming] = useState(false)
  const priceItem = items.find((item) => item.productId === priceProductId)
  const hasBlockingInteraction = Boolean(editingQuantityProductId || priceItem || isClearConfirming)

  function finishInteraction() {
    onInteractionComplete?.()
  }

  function closePriceDialog() {
    setPriceProductId(null)
    finishInteraction()
  }

  function closeClearDialog() {
    setIsClearConfirming(false)
    finishInteraction()
  }

  useEffect(() => {
    onDialogOpenChange?.(hasBlockingInteraction)
    return () => onDialogOpenChange?.(false)
  }, [hasBlockingInteraction, onDialogOpenChange])

  return (
    <>
    <section className="cart-panel" aria-labelledby="cart-title">
      <header className="cart-header">
        <div>
          <p className="eyebrow">Panier</p>
          <div className="cart-title-row">
            <h2 id="cart-title">Vente en cours</h2>
            {items.length > 0 ? <span className="cart-count">{items.length} produit{items.length > 1 ? "s" : ""}</span> : null}
          </div>
        </div>
        {items.length > 0 ? (
          <button
            className="text-button danger-button clear-cart-button"
            type="button"
            title="Vider le panier"
            onClick={() => setIsClearConfirming(true)}
          >
            <TrashIcon />
            Vider
          </button>
        ) : null}
      </header>

      {items.length === 0 ? (
        <div className="empty-cart">
          <span className="empty-cart-icon" aria-hidden="true"><CartIcon /></span>
          <strong>Panier vide</strong>
          <span>Scannez un article ou sélectionnez-le dans le catalogue.</span>
        </div>
      ) : (
        <ul className="cart-list">
          {items.map((item) => (
            <li key={item.productId} className="cart-item">
              <div className="cart-item-heading">
                <div className="cart-item-identity">
                  <div className="cart-item-name-row">
                    <strong>{item.name}</strong>
                    {item.unitPrice !== (item.catalogUnitPrice ?? item.unitPrice) ? <span className="price-override-badge">Prix modifié</span> : null}
                  </div>
                  <span>
                    {formatQuantity(item.quantityMilli ?? (item.quantity ?? 0) * 1000, item.saleUnit ?? "UNIT")} × {formatMoney(item.unitPrice)}{item.saleUnit === "KG" ? "/kg" : ""}
                  </span>
                </div>
                <div className="cart-item-corner">
                  <strong className="cart-line-total">{formatMoney(lineTotal(item.unitPrice, item.quantityMilli ?? (item.quantity ?? 0) * 1000))}</strong>
                  <button
                    className="cart-remove-corner"
                    type="button"
                    aria-label={`Supprimer ${item.name} du panier`}
                    title="Supprimer l’article"
                    onClick={() => {
                      onRemove(item.productId)
                      finishInteraction()
                    }}
                  >
                    <XIcon />
                  </button>
                </div>
              </div>

              <div className="cart-item-actions">
                <QuantityControl
                  valueMilli={item.quantityMilli ?? (item.quantity ?? 0) * 1000}
                  saleUnit={item.saleUnit ?? "UNIT"}
                  minimumMilli={item.saleUnit === "KG" ? 100 : 1000}
                  maximumMilli={item.stockMilli ?? (item.stock ?? 0) * 1000}
                  quantityLabel={`Quantité de ${item.name}`}
                  decreaseLabel={`Diminuer ${item.name}`}
                  increaseLabel={`Augmenter ${item.name}`}
                  onDecrease={() => onDecrement(item.productId)}
                  onIncrease={() => onIncrement(item.productId)}
                  onCommit={(quantityMilli) => onQuantityChange(item.productId, quantityMilli)}
                  onEditingChange={(isEditing) => {
                    setEditingQuantityProductId(isEditing ? item.productId : null)
                    if (!isEditing) finishInteraction()
                  }}
                />
                <button
                  className="cart-action-button cart-edit-price"
                  type="button"
                  aria-label="Modifier le prix"
                  title="Modifier le prix"
                  onClick={() => setPriceProductId(item.productId)}
                >
                  <PencilIcon />
                  Prix
                </button>
              </div>
              {item.unitPrice !== (item.catalogUnitPrice ?? item.unitPrice) ? (
                <p className="price-override-note">
                  Prix catalogue : <span>{formatMoney(item.catalogUnitPrice!)}{item.saleUnit === "KG" ? "/kg" : ""}</span>
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <footer className="cart-summary">
        <div className="cart-total-block">
          <span>Total à payer</span>
          <strong>{formatMoney(total)}</strong>
          {items.length > 0 ? (
            <small>{items.length} produit{items.length > 1 ? "s" : ""} dans la vente</small>
          ) : null}
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

    {priceItem ? (
      <PriceDialog
        item={priceItem}
        onClose={closePriceDialog}
        onApply={(price) => {
          onPriceChange(priceItem.productId, price)
          closePriceDialog()
        }}
      />
    ) : null}
    {isClearConfirming ? (
      <Dialog eyebrow="Vente en cours" title="Vider le panier ?" onClose={closeClearDialog}>
        <div className="pos-dialog-body">
          <p>Les {items.length} article{items.length > 1 ? "s" : ""} seront retirés de la vente en cours.</p>
          <div className="modal-actions">
            <button className="button button-secondary" type="button" onClick={closeClearDialog}>Annuler</button>
            <button className="button button-destructive" type="button" onClick={() => {
              onClear()
              closeClearDialog()
            }}>Vider le panier</button>
          </div>
        </div>
      </Dialog>
    ) : null}
    </>
  )
}
