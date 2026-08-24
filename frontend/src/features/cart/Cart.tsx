import { useEffect, useRef, useState } from "react"

import { CartIcon, MinusIcon, PencilIcon, PlusIcon, TrashIcon, XIcon } from "../../components/ui/Icons"
import { Dialog } from "../../components/ui/Dialog"
import { formatMoney } from "../../utils/money"
import type { CartItem } from "./cartState"
import { formatQuantity, lineTotal, milliToDisplayQuantity, parseQuantityToMilli } from "../../utils/quantity"
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
  const [quantityEditor, setQuantityEditor] = useState<{
    productId: string
    value: string
  } | null>(null)
  const [priceProductId, setPriceProductId] = useState<string | null>(null)
  const [isClearConfirming, setIsClearConfirming] = useState(false)
  const quantityInputRef = useRef<HTMLInputElement>(null)
  const cancelQuantityBlurRef = useRef(false)
  const priceItem = items.find((item) => item.productId === priceProductId)
  const hasBlockingInteraction = Boolean(quantityEditor || priceItem || isClearConfirming)

  function finishInteraction() {
    onInteractionComplete?.()
  }

  function startQuantityEditing(item: CartItem) {
    const quantityMilli = item.quantityMilli ?? (item.quantity ?? 0) * 1000
    const value = item.saleUnit === "KG"
      ? milliToDisplayQuantity(quantityMilli)
      : String(quantityMilli / 1000)
    cancelQuantityBlurRef.current = false
    setQuantityEditor({ productId: item.productId, value })
  }

  function finishQuantityEditing(item: CartItem, apply: boolean) {
    if (!quantityEditor || quantityEditor.productId !== item.productId) return
    const parsed = parseQuantityToMilli(quantityEditor.value)
    const stockMilli = item.stockMilli ?? (item.stock ?? Number.MAX_SAFE_INTEGER) * 1000
    const currentQuantityMilli = item.quantityMilli ?? (item.quantity ?? 0) * 1000
    const isValid =
      parsed !== null &&
      (item.saleUnit === "KG" || parsed % 1000 === 0) &&
      parsed <= stockMilli

    if (!apply) cancelQuantityBlurRef.current = true
    if (
      apply &&
      !cancelQuantityBlurRef.current &&
      isValid &&
      parsed !== currentQuantityMilli
    ) {
      onQuantityChange(item.productId, parsed)
    }
    setQuantityEditor(null)
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
    onDialogOpenChange?.(hasBlockingInteraction)
    return () => onDialogOpenChange?.(false)
  }, [hasBlockingInteraction, onDialogOpenChange])

  useEffect(() => {
    if (!quantityEditor) return
    quantityInputRef.current?.focus()
    quantityInputRef.current?.select()
  }, [quantityEditor?.productId])

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
                  {quantityEditor?.productId === item.productId ? (
                    <span className="quantity-input-wrap">
                      <input
                        ref={quantityInputRef}
                        className={`quantity-input${item.saleUnit === "KG" ? " quantity-input-weight" : ""}`}
                        type="text"
                        inputMode={item.saleUnit === "KG" ? "decimal" : "numeric"}
                        enterKeyHint="done"
                        aria-label={`Quantité de ${item.name}`}
                        value={quantityEditor.value}
                        onChange={(event) => setQuantityEditor({
                          productId: item.productId,
                          value: event.target.value,
                        })}
                        onBlur={() => finishQuantityEditing(item, true)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault()
                            event.currentTarget.blur()
                          } else if (event.key === "Escape") {
                            event.preventDefault()
                            finishQuantityEditing(item, false)
                          }
                        }}
                      />
                      {item.saleUnit === "KG" ? <span aria-hidden="true">kg</span> : null}
                    </span>
                  ) : (
                    <button
                      className="quantity-value"
                      type="button"
                      aria-label={`Quantité de ${item.name}`}
                      title="Modifier la quantité"
                      onClick={() => startQuantityEditing(item)}
                    >
                      {formatQuantity(item.quantityMilli ?? (item.quantity ?? 0) * 1000, item.saleUnit ?? "UNIT")}
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label={`Augmenter ${item.name}`}
                    disabled={(item.quantityMilli ?? (item.quantity ?? 0) * 1000) >= (item.stockMilli ?? (item.stock ?? 0) * 1000)}
                    onClick={() => onIncrement(item.productId)}
                  >
                    <PlusIcon />
                  </button>
                </div>
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
          <small>{items.length} produit{items.length > 1 ? "s" : ""} dans la vente</small>
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
