import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { QueryClientProvider } from "@tanstack/react-query"
import { RouterProvider } from "react-router-dom"

import { Sentry, initSentry } from "./analytics/sentry"
import { AppErrorFallback } from "./components/ui/AppErrorBoundary"
import { repairPendingSoldQuantities } from "./db/recovery"
import { initPostHog } from "./analytics/posthog"
import { createQueryClient } from "./queryClient"
import { router } from "./router"
import { registerOfflineServiceWorker } from "./serviceWorker"
import "./styles.css"

initSentry()
initPostHog()
if (import.meta.env.PROD) registerOfflineServiceWorker()

const queryClient = createQueryClient()
const root = createRoot(document.getElementById("root")!)

async function bootstrap() {
  try {
    await repairPendingSoldQuantities()
  } catch (error) {
    Sentry.captureException(error, { tags: { storage_operation: "startup_recovery" } })
    root.render(<AppErrorFallback />)
    return
  }

  root.render(
    <StrictMode>
      <Sentry.ErrorBoundary fallback={<AppErrorFallback />}>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </Sentry.ErrorBoundary>
    </StrictMode>,
  )
}

void bootstrap()
