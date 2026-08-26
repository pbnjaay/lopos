import { useEffect, useRef, useState } from "react"

import { formatQuantity, milliToDisplayQuantity, parseQuantityToMilli } from "../../utils/quantity"
import { MinusIcon, PlusIcon } from "./Icons"

type QuantityControlProps = {
  valueMilli: number | null
  saleUnit: "UNIT" | "KG"
  minimumMilli?: number
  maximumMilli: number
  disabled?: boolean
  inputId?: string
  quantityLabel: string
  decreaseLabel: string
  increaseLabel: string
  onDecrease: () => void
  onIncrease: () => void
  onCommit?: (valueMilli: number) => void
  onEditingChange?: (isEditing: boolean) => void
}

export function QuantityControl({
  valueMilli,
  saleUnit,
  minimumMilli = 0,
  maximumMilli,
  disabled = false,
  inputId,
  quantityLabel,
  decreaseLabel,
  increaseLabel,
  onDecrease,
  onIncrease,
  onCommit,
  onEditingChange,
}: QuantityControlProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [draftValue, setDraftValue] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)
  const cancelRef = useRef(false)

  useEffect(() => {
    if (!isEditing) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [isEditing])

  function startEditing() {
    if (disabled) return
    cancelRef.current = false
    setDraftValue(valueMilli === null
      ? ""
      : saleUnit === "KG"
        ? milliToDisplayQuantity(valueMilli)
        : String(valueMilli / 1000))
    setIsEditing(true)
    onEditingChange?.(true)
  }

  function finishEditing(apply: boolean) {
    if (!isEditing) return
    const parsed = parseQuantityToMilli(draftValue)
    const isValid =
      parsed !== null &&
      parsed >= minimumMilli &&
      parsed <= maximumMilli &&
      (saleUnit === "KG" || parsed % 1000 === 0)

    if (!apply) cancelRef.current = true
    if (apply && !cancelRef.current && isValid && parsed !== valueMilli) {
      onCommit?.(parsed)
    }
    setIsEditing(false)
    onEditingChange?.(false)
  }

  const decreaseDisabled = disabled || valueMilli === null || valueMilli <= minimumMilli
  const increaseDisabled = disabled || (valueMilli ?? 0) >= maximumMilli
  return (
    <div className="quantity-control" role="group" aria-label={`Contrôles — ${quantityLabel}`}>
      <button
        className="quantity-step"
        type="button"
        aria-label={decreaseLabel}
        disabled={decreaseDisabled}
        onClick={onDecrease}
      >
        <MinusIcon />
      </button>
      {isEditing ? (
        <span className="quantity-input-wrap">
          <input
            ref={inputRef}
            id={inputId}
            className={`quantity-input${saleUnit === "KG" ? " quantity-input-weight" : ""}`}
            type="text"
            inputMode={saleUnit === "KG" ? "decimal" : "numeric"}
            enterKeyHint="done"
            aria-label={quantityLabel}
            placeholder="0"
            value={draftValue}
            disabled={disabled}
            onChange={(event) => setDraftValue(event.target.value)}
            onBlur={() => finishEditing(true)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                event.currentTarget.blur()
              } else if (event.key === "Escape") {
                event.preventDefault()
                finishEditing(false)
              }
            }}
          />
          {saleUnit === "KG" ? <span aria-hidden="true">kg</span> : null}
        </span>
      ) : (
        <button
          id={inputId}
          className="quantity-value"
          type="button"
          aria-label={quantityLabel}
          title="Modifier la quantité"
          disabled={disabled}
          onClick={startEditing}
        >
          {valueMilli === null ? "0" : formatQuantity(valueMilli, saleUnit)}
        </button>
      )}
      <button
        className="quantity-step"
        type="button"
        aria-label={increaseLabel}
        disabled={increaseDisabled}
        onClick={onIncrease}
      >
        <PlusIcon />
      </button>
    </div>
  )
}
