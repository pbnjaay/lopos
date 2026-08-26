import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"

import { IconButton } from "./IconButton"
import { XIcon } from "./Icons"
import type { AlertTone } from "./InlineAlert"

export type ToastOptions = {
  description?: string
  /** Reste affiché jusqu'à fermeture explicite. Réservé aux erreurs. */
  persistent?: boolean
}

type Toast = {
  id: number
  tone: AlertTone
  title: string
  description?: string
  persistent: boolean
}

type ToastApi = {
  success: (title: string, options?: ToastOptions) => void
  info: (title: string, options?: ToastOptions) => void
  warning: (title: string, options?: ToastOptions) => void
  error: (title: string, options?: ToastOptions) => void
  dismiss: (id: number) => void
}

/** Durées par sévérité — jamais codées en dur sur un appel. */
const durationByTone: Record<AlertTone, number> = {
  success: 3_000,
  info: 4_000,
  warning: 5_000,
  error: 8_000,
}

const MAX_VISIBLE_TOASTS = 3

const ToastContext = createContext<ToastApi | null>(null)

export function ToastProvider({ children }: PropsWithChildren) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const push = useCallback((tone: AlertTone, title: string, options?: ToastOptions) => {
    setToasts((current) => {
      // Déduplication : un même événement répété (reconnexions successives,
      // double clic, boucle de sync) rafraîchit le message existant au lieu
      // d'empiler quatre fois la même phrase.
      const duplicate = current.find((toast) => toast.tone === tone && toast.title === title)
      if (duplicate) {
        return current.map((toast) =>
          toast.id === duplicate.id
            ? { ...toast, id: nextId.current++, description: options?.description }
            : toast,
        )
      }
      const toast: Toast = {
        id: nextId.current++,
        tone,
        title,
        description: options?.description,
        persistent: options?.persistent ?? false,
      }
      return [...current, toast].slice(-MAX_VISIBLE_TOASTS)
    })
  }, [])

  const api = useMemo<ToastApi>(
    () => ({
      success: (title, options) => push("success", title, options),
      info: (title, options) => push("info", title, options),
      warning: (title, options) => push("warning", title, options),
      error: (title, options) => push("error", title, options),
      dismiss,
    }),
    [dismiss, push],
  )

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  )
}

function ToastViewport({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  if (toasts.length === 0) return null

  return (
    <div className="toast-viewport" aria-live="polite" aria-atomic="false">
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  )
}

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  useEffect(() => {
    if (toast.persistent) return
    const timeoutId = window.setTimeout(() => onDismiss(toast.id), durationByTone[toast.tone])
    return () => window.clearTimeout(timeoutId)
  }, [onDismiss, toast.id, toast.persistent, toast.tone])

  return (
    <div className={`toast toast-${toast.tone}`} role={toast.tone === "error" ? "alert" : "status"}>
      <div className="toast-copy">
        <strong>{toast.title}</strong>
        {toast.description ? <span>{toast.description}</span> : null}
      </div>
      <IconButton
        label="Fermer la notification"
        icon={<XIcon />}
        shape="round"
        className="toast-close"
        onClick={() => onDismiss(toast.id)}
      />
    </div>
  )
}

/**
 * Notifications courtes et non bloquantes. Tout ce qui doit rester lisible
 * (validation de champ, erreur bloquante, statut permanent) passe par
 * InlineAlert, ErrorState ou ConnectionStatus — pas par un toast.
 */
export function useToast(): ToastApi {
  const api = useContext(ToastContext)
  if (!api) {
    throw new Error("useToast doit être utilisé à l'intérieur d'un ToastProvider.")
  }
  return api
}

/** Variante tolérante : renvoie `null` hors provider, pour les composants
 *  montés isolément dans les tests. */
export function useOptionalToast(): ToastApi | null {
  return useContext(ToastContext)
}
