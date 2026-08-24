import { type ReactNode, type RefObject, useEffect, useId, useRef } from "react"

import { XIcon } from "./Icons"
import { useDialogFocusTrap } from "./useDialogFocusTrap"

type DialogProps = {
  title: string
  eyebrow?: string
  children: ReactNode
  onClose: () => void
  initialFocusRef?: RefObject<HTMLElement | null>
  className?: string
  closeLabel?: string
  dismissible?: boolean
}

export function Dialog({
  title,
  eyebrow,
  children,
  onClose,
  initialFocusRef,
  className = "",
  closeLabel = "Fermer",
  dismissible = true,
}: DialogProps) {
  const titleId = useId()
  const dialogRef = useRef<HTMLElement>(null)
  useDialogFocusTrap(dialogRef)

  useEffect(() => {
    initialFocusRef?.current?.focus()

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && dismissible) {
        event.preventDefault()
        event.stopImmediatePropagation()
        onClose()
        return
      }
    }

    document.addEventListener("keydown", handleKeyDown, true)
    return () => document.removeEventListener("keydown", handleKeyDown, true)
  }, [dismissible, initialFocusRef, onClose])

  return (
    <div className="modal-backdrop">
      <section
        ref={dialogRef}
        className={`checkout-modal pos-dialog ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className="checkout-modal-header">
          <div>
            {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
            <h2 id={titleId}>{title}</h2>
          </div>
          {dismissible ? (
            <button className="modal-close" type="button" aria-label={closeLabel} onClick={onClose}>
              <XIcon />
            </button>
          ) : null}
        </header>
        {children}
      </section>
    </div>
  )
}
