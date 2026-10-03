import * as Sentry from "@sentry/react"

import type { CurrentUser } from "../types/api"

export function initSentry() {
  const dsn = import.meta.env.VITE_SENTRY_DSN
  if (!dsn) return

  Sentry.init({
    dsn,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || "development",
    release: import.meta.env.VITE_SENTRY_RELEASE || undefined,
    sendDefaultPii: false,
    tracesSampleRate: 0.1,
  })
}

export function setSentryUser(user: CurrentUser) {
  Sentry.setUser({ id: String(user.id), role: user.is_staff ? "staff" : "cashier" })
}

export function clearSentryUser() {
  Sentry.setUser(null)
}

export { Sentry }
