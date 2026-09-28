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

import { Button } from "./Button"
import { IconButton } from "./IconButton"
import { XIcon } from "./Icons"
import type { AlertTone } from "./InlineAlert"

export type ToastOptions = {
  description?: string
  /** Reste affiché jusqu'à fermeture explicite. Réservé aux erreurs. */
  persistent?: boolean
  /** Action de rattrapage (« Annuler ») — le toast se ferme après le clic. */
  action?: ToastAction
}

export type ToastAction = {
  label: string
  onClick: () => void
}

type Toast = {
  id: number
  tone: AlertTone
  title: string
  description?: string
  persistent: boolean
  action?: ToastAction
}

/** Chaque appel renvoie l'identifiant du toast, pour pouvoir le retirer. */
type ToastApi = {
  success: (title: string, options?: ToastOptions) => number
  info: (title: string, options?: ToastOptions) => number
  warning: (title: string, options?: ToastOptions) => number
  error: (title: string, options?: ToastOptions) => number
  dismiss: (id: number) => void
}

/** Durées par sévérité — jamais codées en dur sur un appel. */
const durationByTone: Record<AlertTone, number> = {
  success: 3_000,
  info: 4_000,
  warning: 5_000,
  error: 8_000,
}

/** Le temps de voir l'erreur et d'atteindre le bouton, au doigt compris. */
const MIN_ACTION_DURATION = 6_000

const MAX_VISIBLE_TOASTS = 3

const ToastContext = createContext<ToastApi | null>(null)

export function ToastProvider({ children }: PropsWithChildren) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const push = useCallback((tone: AlertTone, title: string, options?: ToastOptions) => {
    // Identifiant réservé hors du updater : React peut rejouer celui-ci.
    const id = nextId.current++
    setToasts((current) => {
      // Déduplication : un même événement répété (reconnexions successives,
      // double clic, boucle de sync) rafraîchit le message existant au lieu
      // d'empiler quatre fois la même phrase.
      const duplicate = current.find((toast) => toast.tone === tone && toast.title === title)
      if (duplicate) {
        return current.map((toast) =>
          toast.id === duplicate.id
            ? { ...toast, id, description: options?.description, action: options?.action }
            : toast,
        )
      }
      const toast: Toast = {
        id,
        tone,
        title,
        description: options?.description,
        persistent: options?.persistent ?? false,
        action: options?.action,
      }
      return [...current, toast].slice(-MAX_VISIBLE_TOASTS)
    })
    return id
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
    const duration = toast.action
      ? Math.max(durationByTone[toast.tone], MIN_ACTION_DURATION)
      : durationByTone[toast.tone]
    const timeoutId = window.setTimeout(() => onDismiss(toast.id), duration)
    return () => window.clearTimeout(timeoutId)
  }, [onDismiss, toast.action, toast.id, toast.persistent, toast.tone])

  return (
    <div className={`toast toast-${toast.tone}`} role={toast.tone === "error" ? "alert" : "status"}>
      <div className="toast-copy">
        <strong>{toast.title}</strong>
        {toast.description ? <span>{toast.description}</span> : null}
      </div>
      {toast.action ? (
        <Button
          variant="secondary"
          size="sm"
          className="toast-action"
          onClick={() => {
            toast.action!.onClick()
            onDismiss(toast.id)
          }}
        >
          {toast.action.label}
        </Button>
      ) : null}
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
