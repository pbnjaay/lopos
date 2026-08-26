import { Navigate } from "react-router-dom"

import { RouteError, RouteLoading } from "../components/ui/RouteState"
import { useCurrentUser } from "../features/auth/queries"
import { usePosSession } from "../features/cash-session/queries"
import type { CurrentUser } from "../types/api"

function AuthenticatedEntry({ user }: { user: CurrentUser }) {
  const session = usePosSession(user)

  if (session.isLoading) return <RouteLoading message="Recherche de la caisse…" />
  if (session.error) {
    return (
      <RouteError
        error={session.error}
        context="session"
        onRetry={() => void session.refetch()}
      />
    )
  }

  return <Navigate to={session.ownSession ? "/pos" : "/cash/open"} replace />
}

export function AppEntryPage() {
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
  if (!userQuery.data) return <Navigate to="/login" replace />

  return <AuthenticatedEntry user={userQuery.data} />
}
