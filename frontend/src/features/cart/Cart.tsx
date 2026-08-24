import { useEffect, useState } from "react"

import { MinusIcon, PencilIcon, PlusIcon, TrashIcon } from "../../components/ui/Icons"
import { Dialog } from "../../components/ui/Dialog"
import { formatMoney } from "../../utils/money"
import type { CartItem } from "./cartState"
import { formatQuantity, lineTotal } from "../../utils/quantity"
import { PriceDialog, QuantityDialog } from "./CartDialogs"

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
  const [quantityProductId, setQuantityProductId] = useState<string | null>(null)
  const [priceProductId, setPriceProductId] = useState<string | null>(null)
  const [isClearConfirming, setIsClearConfirming] = useState(false)
  const quantityItem = items.find((item) => item.productId === quantityProductId)
  const priceItem = items.find((item) => item.productId === priceProductId)
  const hasDialog = Boolean(quantityItem || priceItem || isClearConfirming)

  function finishInteraction() {
    onInteractionComplete?.()
  }

  function closeQuantityDialog() {
    setQuantityProductId(null)
    finishInteraction()
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
    onDialogOpenChange?.(hasDialog)
    return () => onDialogOpenChange?.(false)
  }, [hasDialog, onDialogOpenChange])

  return (
    <>
    <section className="cart-panel" aria-labelledby="cart-title">
      <header className="cart-header">
        <div>
          <p className="eyebrow">Vente en cours</p>
          <h2 id="cart-title">Panier</h2>
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
                    <MinusIcon />
                  </button>
                  <button
                    className="quantity-value"
                    type="button"
                    aria-label={`Quantité de ${item.name}`}
                    title="Modifier la quantité"
                    onClick={() => setQuantityProductId(item.productId)}
                  >
                    {formatQuantity(item.quantityMilli ?? (item.quantity ?? 0) * 1000, item.saleUnit ?? "UNIT")}
                  </button>
                  <button
                    type="button"
                    aria-label={`Augmenter ${item.name}`}
                    disabled={(item.quantityMilli ?? (item.quantity ?? 0) * 1000) >= (item.stockMilli ?? (item.stock ?? 0) * 1000)}
                    onClick={() => onIncrement(item.productId)}
                  >
                    <PlusIcon />
                  </button>
                </div>
                <div className="cart-item-secondary-actions">
                  <button
                    className="text-button cart-edit-price"
                    type="button"
                    aria-label="Modifier le prix"
                    title="Modifier le prix"
                    onClick={() => setPriceProductId(item.productId)}
                  >
                    <PencilIcon />
                    Prix
                  </button>
                  <button
                    className="icon-button danger-button"
                    type="button"
                    aria-label={`Supprimer ${item.name} du panier`}
                    title="Supprimer l’article"
                    onClick={() => {
                      onRemove(item.productId)
                      finishInteraction()
                    }}
                  >
                    <TrashIcon />
                  </button>
                </div>
              </div>
              {item.unitPrice !== (item.catalogUnitPrice ?? item.unitPrice) ? (
                <p className="price-override-note">
                  <span>{formatMoney(item.catalogUnitPrice!)}{item.saleUnit === "KG" ? "/kg" : ""}</span>
                  Prix modifié
                </p>
              ) : null}
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

    {quantityItem ? (
      <QuantityDialog
        item={quantityItem}
        quantityMilli={quantityItem.quantityMilli ?? (quantityItem.quantity ?? 0) * 1000}
        onClose={closeQuantityDialog}
        onApply={(quantityMilli) => {
          onQuantityChange(quantityItem.productId, quantityMilli)
          closeQuantityDialog()
        }}
      />
    ) : null}
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
