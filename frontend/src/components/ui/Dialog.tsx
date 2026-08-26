import { type ReactNode, type RefObject, useEffect, useId, useRef } from "react"

import { IconButton } from "./IconButton"
import { XIcon } from "./Icons"
import { useDialogFocusTrap } from "./useDialogFocusTrap"

export type DialogSize = "sm" | "md" | "lg"

type DialogProps = {
  title: string
  eyebrow?: string
  size?: DialogSize
  children: ReactNode
  onClose: () => void
  /**
   * Étape précédente d'un parcours en plusieurs écrans. Quand elle existe,
   * Escape recule d'un pas au lieu de tout fermer.
   */
  onBack?: () => void
  backLabel?: string
  backDisabled?: boolean
  initialFocusRef?: RefObject<HTMLElement | null>
  className?: string
  closeLabel?: string
  dismissible?: boolean
}

/**
 * Modale unique de l'application : même structure (titre → description →
 * contenu → pied), trois largeurs, Escape, piège de focus et restauration
 * du focus à la fermeture.
 */
export function Dialog({
  title,
  eyebrow,
  size = "md",
  children,
  onClose,
  onBack,
  backLabel = "Retour",
  backDisabled = false,
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
      // Une touche Echap maintenue ne doit pas empiler les fermetures.
      if (event.repeat || event.key !== "Escape" || !dismissible) return
      event.preventDefault()
      event.stopImmediatePropagation()
      if (onBack) onBack()
      else onClose()
    }

    window.addEventListener("keydown", handleKeyDown, true)
    return () => window.removeEventListener("keydown", handleKeyDown, true)
  }, [dismissible, initialFocusRef, onBack, onClose])

  return (
    <div className="dialog-backdrop">
      <section
        ref={dialogRef}
        className={`dialog dialog-${size} ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className="dialog-header">
          <div className="dialog-header-identity">
            {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
            {onBack ? (
              <button
                className="dialog-back"
                type="button"
                disabled={backDisabled}
                onClick={onBack}
              >
                ← {backLabel}
              </button>
            ) : null}
            <h2 id={titleId}>{title}</h2>
          </div>
          {dismissible ? (
            <IconButton
              label={closeLabel}
              icon={<XIcon />}
              shape="round"
              surface
              className="dialog-close"
              onClick={onClose}
            />
          ) : null}
        </header>
        {children}
      </section>
    </div>
  )
}

/** Corps de modale — même respiration que le pied qui le suit. */
export function DialogBody({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`dialog-body ${className}`.trim()}>{children}</div>
}

/** Formulaire de modale : même géométrie que `DialogBody`, Enter valide. */
export function DialogForm({
  children,
  onSubmit,
  className = "",
}: {
  children: ReactNode
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void
  className?: string
}) {
  return (
    <form className={`dialog-body ${className}`.trim()} onSubmit={onSubmit}>
      {children}
    </form>
  )
}

/**
 * Pied de modale — convention unique : action secondaire à gauche, action
 * primaire à droite, dans cet ordre sur toutes les modales.
 */
export function DialogFooter({ children }: { children: ReactNode }) {
  return <div className="dialog-footer">{children}</div>
}
