import { type FormEvent, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Navigate, useLocation, useNavigate } from "react-router-dom"

import { login } from "../api/auth"
import { RouteState } from "../components/ui/RouteState"
import { currentUserQueryKey, useCurrentUser } from "../features/auth/queries"

type LocationState = {
  from?: string
}

export function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const userQuery = useCurrentUser()
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const loginMutation = useMutation({
    mutationFn: login,
    onSuccess: (user) => {
      queryClient.setQueryData(currentUserQueryKey, user)
      const requestedPath = (location.state as LocationState | null)?.from
      navigate(requestedPath || "/", { replace: true })
    },
  })

  if (userQuery.isLoading) return <RouteState message="Vérification de la session…" />
  if (userQuery.data) return <Navigate to="/" replace />

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!username.trim() || !password) return
    loginMutation.mutate({ username: username.trim(), password })
  }

  return (
    <main className="setup-page">
      <section className="setup-card" aria-labelledby="login-title">
        <p className="brand">LoPOS</p>
        <h1 id="login-title">Connexion caisse</h1>
        <p className="muted">Connectez-vous avec votre compte caissier.</p>

        <form className="form-stack" onSubmit={handleSubmit}>
          <label className="field">
            <span>Nom d’utilisateur</span>
            <input
              autoComplete="username"
              autoFocus
              required
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </label>

          <label className="field">
            <span>Mot de passe</span>
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>

          {userQuery.error || loginMutation.error ? (
            <p className="form-error" role="alert">
              {(loginMutation.error ?? userQuery.error)?.message}
            </p>
          ) : null}

          <button
            className="button button-primary"
            type="submit"
            disabled={loginMutation.isPending || !username.trim() || !password}
          >
            {loginMutation.isPending ? "Connexion…" : "Se connecter"}
          </button>
        </form>
      </section>
    </main>
  )
}
