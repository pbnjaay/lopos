import { Navigate } from "react-router-dom"

import { RouteState } from "../components/ui/RouteState"
import { useCurrentUser } from "../features/auth/queries"
import { usePosSession } from "../features/cash-session/queries"

function AuthenticatedEntry({ cashierId }: { cashierId: number }) {
  const session = usePosSession(cashierId)

  if (session.isLoading) return <RouteState message="Recherche de la caisse…" />
  if (session.error) {
    return (
      <RouteState
        message=""
        error={session.error}
        onRetry={() => void session.refetch()}
      />
    )
  }

  return <Navigate to={session.ownSession ? "/pos" : "/cash/open"} replace />
}

export function AppEntryPage() {
  const userQuery = useCurrentUser()

  if (userQuery.isLoading) return <RouteState message="Vérification de la session…" />
  if (userQuery.error) {
    return (
      <RouteState
        message=""
        error={userQuery.error}
        onRetry={() => void userQuery.refetch()}
      />
    )
  }
  if (!userQuery.data) return <Navigate to="/login" replace />

  return <AuthenticatedEntry cashierId={userQuery.data.id} />
}
