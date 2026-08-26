import { Navigate, useLocation } from "react-router-dom"

import { AppLayout } from "../../components/layout/AppLayout"
import { RouteError, RouteLoading } from "../../components/ui/RouteState"
import { useCurrentUser } from "./queries"
import { SyncStatusProvider } from "../sync/useSyncStatus"

export function RequireAuth() {
  const location = useLocation()
  const userQuery = useCurrentUser()

  if (userQuery.isLoading) return <RouteLoading message="Vérification de la session…" />
  if (userQuery.error) {
    return (
      <RouteError
        error={userQuery.error}
        context="session"
        onRetry={() => void userQuery.refetch()}
      />
    )
  }
  if (!userQuery.data) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  return (
    <SyncStatusProvider>
      <AppLayout user={userQuery.data} />
    </SyncStatusProvider>
  )
}
