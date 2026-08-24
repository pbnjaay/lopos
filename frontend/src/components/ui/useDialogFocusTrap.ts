import { type RefObject, useEffect } from "react"

export const dialogFocusableSelector = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",")

export function useDialogFocusTrap(dialogRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    const surface = dialogRef.current
    if (!surface) return
    const activeSurface: HTMLElement = surface
    if (!activeSurface.contains(document.activeElement)) {
      activeSurface.querySelector<HTMLElement>(dialogFocusableSelector)?.focus()
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Tab") return
      const focusable = Array.from(activeSurface.querySelectorAll<HTMLElement>(dialogFocusableSelector))
      if (focusable.length === 0) {
        event.preventDefault()
        activeSurface.focus()
        return
      }
      const first = focusable[0]!
      const last = focusable[focusable.length - 1]!
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener("keydown", handleKeyDown, true)
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true)
      previouslyFocused?.focus()
    }
  }, [dialogRef])
}
