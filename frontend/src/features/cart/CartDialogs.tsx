import { type FormEvent, useEffect, useRef, useState } from "react"

import { Dialog } from "../../components/ui/Dialog"
import { formatMoney, parseMoneyInput } from "../../utils/money"
import { formatQuantity, milliToBackendQuantity, parseQuantityToMilli } from "../../utils/quantity"
import type { CartItem } from "./cartState"

type QuantityDialogProps = {
  item: Pick<CartItem, "name" | "unitPrice" | "saleUnit" | "stockMilli" | "stock">
  quantityMilli: number | null
  onApply: (quantityMilli: number) => void
  onClose: () => void
}

export function QuantityDialog({ item, quantityMilli, onApply, onClose }: QuantityDialogProps) {
  const saleUnit = item.saleUnit ?? "UNIT"
  const inputRef = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState(() => {
    if (quantityMilli === null) return ""
    return saleUnit === "KG" ? milliToBackendQuantity(quantityMilli).replace(".", ",") : String(quantityMilli / 1000)
  })
  const [error, setError] = useState("")
  const parsedQuantity = parseQuantityToMilli(value)
  const stockMilli = item.stockMilli ?? (item.stock ?? Number.MAX_SAFE_INTEGER) * 1000
  const isValid = parsedQuantity !== null &&
    (saleUnit === "KG" || parsedQuantity % 1000 === 0) &&
    parsedQuantity <= stockMilli

  useEffect(() => {
    inputRef.current?.select()
  }, [])

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const parsed = parsedQuantity
    if (parsed === null || (saleUnit === "UNIT" && parsed % 1000 !== 0)) {
      setError(saleUnit === "UNIT" ? "Saisissez un nombre entier positif." : "Quantité invalide.")
      return
    }
    if (parsed > stockMilli) {
      setError(`Stock disponible : ${formatQuantity(stockMilli, saleUnit)}.`)
      return
    }
    onApply(parsed)
  }

  return (
    <Dialog
      eyebrow="Panier"
      title="Modifier la quantité"
      onClose={onClose}
      initialFocusRef={inputRef}
    >
      <form className="pos-dialog-form" onSubmit={handleSubmit}>
        <div className="dialog-product-summary">
          <strong>{item.name}</strong>
          <span>{formatMoney(item.unitPrice)} / {saleUnit === "KG" ? "kg" : "unité"}</span>
        </div>
        <div className="field">
          <label htmlFor="quantity-dialog-input">Quantité</label>
          <div className="dialog-suffixed-input">
            <input
              ref={inputRef}
              id="quantity-dialog-input"
              inputMode={saleUnit === "KG" ? "decimal" : "numeric"}
              enterKeyHint="done"
              placeholder={saleUnit === "KG" ? "0,000" : "1"}
              value={value}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? "quantity-dialog-error" : undefined}
              onChange={(event) => {
                setValue(event.target.value)
                setError("")
              }}
            />
            {saleUnit === "KG" ? <span>kg</span> : null}
          </div>
        </div>
        {error ? <p id="quantity-dialog-error" className="form-error" role="alert">{error}</p> : null}
        <div className="modal-actions">
          <button className="button button-secondary" type="button" onClick={onClose}>Annuler</button>
          <button className="button button-primary" type="submit" disabled={!isValid}>Appliquer</button>
        </div>
      </form>
    </Dialog>
  )
}

type PriceDialogProps = {
  item: CartItem
  onApply: (price: number) => void
  onClose: () => void
}

export function PriceDialog({ item, onApply, onClose }: PriceDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const catalogPrice = item.catalogUnitPrice ?? item.unitPrice
  const [value, setValue] = useState(String(item.unitPrice))
  const [error, setError] = useState("")

  useEffect(() => {
    inputRef.current?.select()
  }, [])

  function applyPrice(price: number) {
    onApply(price)
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const parsed = parseMoneyInput(value)
    if (parsed === null || parsed <= 0) {
      setError("Saisissez un prix entier positif.")
      return
    }
    applyPrice(parsed)
  }

  return (
    <Dialog eyebrow="Panier" title="Modifier le prix" onClose={onClose} initialFocusRef={inputRef}>
      <form className="pos-dialog-form" onSubmit={handleSubmit}>
        <div className="dialog-product-summary">
          <strong>{item.name}</strong>
          <span>Prix catalogue : {formatMoney(catalogPrice)}{item.saleUnit === "KG" ? " / kg" : " / unité"}</span>
        </div>
        <div className="field">
          <label htmlFor="price-dialog-input">Prix pour cette vente</label>
          <div className="dialog-suffixed-input">
            <input
              ref={inputRef}
              id="price-dialog-input"
              inputMode="numeric"
              enterKeyHint="done"
              value={value}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? "price-dialog-error" : undefined}
              onChange={(event) => {
                setValue(event.target.value)
                setError("")
              }}
            />
            <span>FCFA{item.saleUnit === "KG" ? " / kg" : ""}</span>
          </div>
        </div>
        {item.unitPrice !== catalogPrice ? (
          <button className="catalog-reset-button" type="button" onClick={() => applyPrice(catalogPrice)}>
            Restaurer le prix catalogue
          </button>
        ) : null}
        {error ? <p id="price-dialog-error" className="form-error" role="alert">{error}</p> : null}
        <div className="modal-actions">
          <button className="button button-secondary" type="button" onClick={onClose}>Annuler</button>
          <button className="button button-primary" type="submit">Appliquer</button>
        </div>
      </form>
    </Dialog>
  )
}
