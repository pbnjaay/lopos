import type { ReactNode } from "react"
import { Navigate } from "react-router-dom"

import { RouteError, RouteLoading } from "../../components/ui/RouteState"
import { useCurrentUser } from "../auth/queries"
import { usePosSession } from "./queries"

type SessionRouteProps = {
  requireOpen: boolean
  children: ReactNode
}

export function SessionRoute({ requireOpen, children }: SessionRouteProps) {
  const userQuery = useCurrentUser()
  const session = usePosSession(userQuery.data!)

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

  if (requireOpen && !session.ownSession) return <Navigate to="/cash/open" replace />
  if (!requireOpen && session.ownSession) return <Navigate to="/pos" replace />

  return children
}
