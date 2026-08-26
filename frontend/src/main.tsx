import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { QueryClientProvider } from "@tanstack/react-query"
import { RouterProvider } from "react-router-dom"

import { Sentry, initSentry } from "./analytics/sentry"
import { initPostHog } from "./analytics/posthog"
import { createQueryClient } from "./queryClient"
import { router } from "./router"
import "./styles.css"

initSentry()
initPostHog()

const queryClient = createQueryClient()

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Sentry.ErrorBoundary fallback={<p role="alert">Une erreur est survenue. Rechargez la page.</p>}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </Sentry.ErrorBoundary>
  </StrictMode>,
)
