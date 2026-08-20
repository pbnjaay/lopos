import posthog from "posthog-js"

import type { CurrentUser } from "../types/api"

function isEnabled(): boolean {
  return (
    import.meta.env.VITE_POSTHOG_ENABLED === "true" && !!import.meta.env.VITE_POSTHOG_KEY
  )
}

export function initPostHog() {
  if (!isEnabled()) return

  posthog.init(import.meta.env.VITE_POSTHOG_KEY, {
    api_host: import.meta.env.VITE_POSTHOG_HOST || "https://us.i.posthog.com",
    autocapture: false,
    capture_pageview: false,
    disable_session_recording: true,
  })
}

export function identifyUser(user: CurrentUser) {
  if (!isEnabled()) return
  posthog.identify(String(user.id), { role: user.is_staff ? "staff" : "cashier" })
}

export function resetAnalytics() {
  if (!isEnabled()) return
  posthog.reset()
}

export function capture(event: string, properties?: Record<string, unknown>) {
  if (!isEnabled()) return
  posthog.capture(event, properties)
}
