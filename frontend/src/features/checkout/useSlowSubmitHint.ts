import { useEffect, useState } from "react"

/**
 * True once `isSubmitting` has been true for longer than `delayMs`. Lets a
 * payment modal reassure the cashier that it is still working instead of
 * leaving a static "Validation…" label with no sign of life while a slow or
 * stuck network request runs its course.
 */
export function useSlowSubmitHint(isSubmitting: boolean, delayMs = 2_500): boolean {
  const [isSlow, setIsSlow] = useState(false)

  useEffect(() => {
    if (!isSubmitting) {
      setIsSlow(false)
      return
    }
    const timer = setTimeout(() => setIsSlow(true), delayMs)
    return () => clearTimeout(timer)
  }, [isSubmitting, delayMs])

  return isSlow
}
