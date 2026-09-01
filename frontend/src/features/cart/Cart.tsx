import { useEffect, useRef, useState } from "react"

import { PauseIcon, PencilIcon, TrashIcon, XIcon } from "../../components/ui/Icons"
import { Badge } from "../../components/ui/Badge"
import { Button } from "../../components/ui/Button"
import { Dialog, DialogBody, DialogFooter } from "../../components/ui/Dialog"
import { IconButton } from "../../components/ui/IconButton"
import { Money } from "../../components/ui/Money"
import { QuantityControl } from "../../components/ui/QuantityControl"
import { formatMoney } from "../../utils/money"
import type { CartItem } from "./cartState"
import { lineTotal } from "../../utils/quantity"
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
  onSuspend: () => void
  onDialogOpenChange?: (isOpen: boolean) => void
  onInteractionComplete?: () => void
}

function itemQuantityMilli(item: CartItem): number {
  return item.quantityMilli ?? (item.quantity ?? 0) * 1000
}

function isPriceOverridden(item: CartItem): boolean {
  return item.unitPrice !== (item.catalogUnitPrice ?? item.unitPrice)
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
  onSuspend,
  onDialogOpenChange,
  onInteractionComplete,
}: CartProps) {
  const [editingQuantityProductId, setEditingQuantityProductId] = useState<string | null>(null)
  const [priceProductId, setPriceProductId] = useState<string | null>(null)
  const [isClearConfirming, setIsClearConfirming] = useState(false)
  const cancelClearRef = useRef<HTMLButtonElement>(null)
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
      {/* En-tête sur une seule ligne : le panier est la surface de travail,
          il n'a pas besoin d'un eyebrow pour dire ce qu'il est. */}
      <header className="cart-header">
        <div className="cart-title-row">
          <h2 id="cart-title">Vente en cours</h2>
          {items.length > 0 ? (
            <Badge tone="neutral">{items.length} produit{items.length > 1 ? "s" : ""}</Badge>
          ) : null}
        </div>
        <div className="cart-header-actions">
          {/* Suspendre est productif, vider est destructif et rare : le
              premier garde un libellé, le second se réduit à une icône.
              Retirer les articles n'est pas une suppression définitive — le
              caissier les rescanne — donc le rouge reste sur la
              confirmation qui suit, pas sur le bouton. */}
          {items.length > 0 ? (
            <Button
              variant="secondary"
              size="sm"
              title="Mettre la vente en attente"
              onClick={onSuspend}
            >
              <PauseIcon />
              Suspendre
            </Button>
          ) : null}
          {items.length > 0 ? (
            <IconButton
              label="Vider la vente en cours"
              title="Vider la vente"
              icon={<TrashIcon />}
              onClick={() => setIsClearConfirming(true)}
            />
          ) : null}
        </div>
      </header>

      {items.length === 0 ? (
        <div className="empty-cart">
          <strong>Panier vide</strong>
          <span>Scannez ou recherchez un produit pour commencer.</span>
        </div>
      ) : (
        <ul className="cart-list">
          {items.map((item) => {
            const quantityMilli = itemQuantityMilli(item)
            const overridden = isPriceOverridden(item)
            const unitLabel = item.saleUnit === "KG" ? "kg" : "unité"
            return (
              <li key={item.productId} className="cart-item">
                {/* Le prix unitaire est explicitement libellé « / unité » ou
                    « / kg » et vit sous le nom : à quantité 1 il porte le
                    même montant que le total de ligne, et seule cette
                    étiquette dit lequel est lequel. Il tient dans la hauteur
                    du compteur de quantité, la ligne ne grandit donc pas. */}
                <div className="cart-item-identity">
                  <strong title={item.name}>{item.name}</strong>
                  <span
                    className={
                      overridden ? "cart-item-unit cart-item-unit-overridden" : "cart-item-unit"
                    }
                  >
                    {formatMoney(item.unitPrice)} / {unitLabel}
                    {overridden ? <s>{formatMoney(item.catalogUnitPrice!)}</s> : null}
                  </span>
                </div>

                <QuantityControl
                  valueMilli={quantityMilli}
                  saleUnit={item.saleUnit ?? "UNIT"}
                  minimumMilli={item.saleUnit === "KG" ? 100 : 1000}
                  maximumMilli={item.stockMilli ?? (item.stock ?? 0) * 1000}
                  quantityLabel={`Quantité de ${item.name}`}
                  decreaseLabel={`Diminuer ${item.name}`}
                  increaseLabel={`Augmenter ${item.name}`}
                  onDecrease={() => onDecrement(item.productId)}
                  onIncrease={() => onIncrement(item.productId)}
                  onCommit={(nextQuantityMilli) =>
                    onQuantityChange(item.productId, nextQuantityMilli)
                  }
                  onEditingChange={(isEditing) => {
                    setEditingQuantityProductId(isEditing ? item.productId : null)
                    if (!isEditing) finishInteraction()
                  }}
                />

                <strong className="cart-line-total">
                  <Money value={lineTotal(item.unitPrice, quantityMilli)} />
                </strong>

                <div className="cart-item-controls">
                  <IconButton
                    label={`Modifier le prix de ${item.name}`}
                    title="Modifier le prix"
                    icon={<PencilIcon />}
                    onClick={() => setPriceProductId(item.productId)}
                  />
                  <IconButton
                    label={`Supprimer ${item.name} du panier`}
                    title="Supprimer l’article"
                    icon={<XIcon />}
                    tone="danger"
                    onClick={() => {
                      onRemove(item.productId)
                      finishInteraction()
                    }}
                  />
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <footer className="cart-summary">
        <div className="cart-total-amount">
          <span>Total à payer</span>
          <strong><Money value={total} /></strong>
        </div>
        <div className="checkout-button-group">
          <Button
            variant="primary"
            size="lg"
            block
            className="checkout-button"
            disabled={items.length === 0}
            onClick={onCheckout}
          >
            Encaisser
          </Button>
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
      <Dialog
        eyebrow="Vente en cours"
        title="Vider le panier ?"
        size="sm"
        // Action destructive : le focus reste sur « Annuler », Entrée ne
        // vide jamais le panier par inadvertance.
        initialFocusRef={cancelClearRef}
        onClose={closeClearDialog}
      >
        <DialogBody>
          <p>Les {items.length} article{items.length > 1 ? "s" : ""} seront retirés de la vente en cours.</p>
          <DialogFooter>
            <Button ref={cancelClearRef} variant="secondary" onClick={closeClearDialog}>
              Annuler
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                onClear()
                closeClearDialog()
              }}
            >
              Vider le panier
            </Button>
          </DialogFooter>
        </DialogBody>
      </Dialog>
    ) : null}
    </>
  )
}
