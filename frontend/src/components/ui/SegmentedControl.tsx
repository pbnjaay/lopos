import { type KeyboardEvent, useRef } from "react"

type SegmentedControlProps<T extends string> = {
  /** Nom accessible du groupe (ex. « Mode de paiement »). */
  label: string
  options: ReadonlyArray<{ value: T; label: string }>
  value: T
  onChange: (value: T) => void
  disabled?: boolean
}

/**
 * Choix exclusif entre quelques options toujours visibles — un filtre, un
 * moyen de paiement. Sémantique de groupe radio : un seul arrêt de
 * tabulation, les flèches passent d'une option à l'autre.
 */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled = false,
}: SegmentedControlProps<T>) {
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([])

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1
      : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1
        : 0
    if (step === 0) return
    event.preventDefault()
    const next = (index + step + options.length) % options.length
    onChange(options[next]!.value)
    buttonRefs.current[next]?.focus()
  }

  // Sans choix fait (catégorie pas encore choisie), la première option
  // reste atteignable au clavier : sinon le groupe entier serait sauté.
  const hasSelection = options.some((option) => option.value === value)

  return (
    <div className="segmented-control" role="radiogroup" aria-label={label}>
      {options.map((option, index) => {
        const isSelected = option.value === value
        return (
          <button
            key={option.value}
            ref={(element) => {
              buttonRefs.current[index] = element
            }}
            type="button"
            role="radio"
            aria-checked={isSelected}
            tabIndex={isSelected || (!hasSelection && index === 0) ? 0 : -1}
            className={`segmented-control-option${isSelected ? " segmented-control-option-selected" : ""}`}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => handleKeyDown(event, index)}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
