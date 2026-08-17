import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Outlet, useNavigate } from "react-router-dom"

import { logout } from "../../api/auth"
import type { CurrentUser } from "../../types/api"

type AppLayoutProps = {
  user: CurrentUser
}

export function AppLayout({ user }: AppLayoutProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: () => {
      queryClient.clear()
      navigate("/login", { replace: true })
    },
  })

  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="brand">LoPOS</span>
        <div className="user-menu">
          <span>{user.first_name || user.username}</span>
          <button
            className="button button-secondary button-small"
            type="button"
            disabled={logoutMutation.isPending}
            onClick={() => logoutMutation.mutate()}
          >
            {logoutMutation.isPending ? "Déconnexion…" : "Se déconnecter"}
          </button>
        </div>
      </header>
      {logoutMutation.error ? (
        <p className="global-error" role="alert">
          {logoutMutation.error.message}
        </p>
      ) : null}
      <Outlet />
    </div>
  )
}
