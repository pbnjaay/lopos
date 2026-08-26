import { type FormEvent, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Navigate, useLocation, useNavigate } from "react-router-dom"

import { login } from "../api/auth"
import { identifyUser } from "../analytics/posthog"
import { setSentryUser } from "../analytics/sentry"
import { Button } from "../components/ui/Button"
import { InlineAlert } from "../components/ui/InlineAlert"
import { RouteLoading } from "../components/ui/RouteState"
import { currentUserQueryKey, useCurrentUser } from "../features/auth/queries"
import { describeErrorShort } from "../utils/errorCopy"

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
      identifyUser(user)
      setSentryUser(user)
      const requestedPath = (location.state as LocationState | null)?.from
      navigate(requestedPath || "/", { replace: true })
    },
  })

  if (userQuery.isLoading) return <RouteLoading message="Vérification de la session…" />
  if (userQuery.data) return <Navigate to="/" replace />

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!username.trim() || !password) return
    loginMutation.mutate({ username: username.trim(), password })
  }

  // Identifiants refusés : message métier du backend, jamais le code HTTP.
  const failure = loginMutation.error ?? userQuery.error
  const failureMessage = failure ? describeErrorShort(failure, "session") : null

  return (
    <main className="setup-page">
      <section className="setup-card" aria-labelledby="login-title">
        <p className="brand">LoPOS</p>
        <p className="eyebrow">Point de vente</p>
        <h1 id="login-title">Connexion caisse</h1>
        <p className="metadata">Connectez-vous avec votre compte caissier.</p>

        <form className="form-stack" onSubmit={handleSubmit}>
          <label className="field">
            <span className="field-label">Nom d’utilisateur</span>
            <input
              autoComplete="username"
              autoFocus
              required
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </label>

          <label className="field">
            <span className="field-label">Mot de passe</span>
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>

          {failureMessage ? <InlineAlert tone="error">{failureMessage}</InlineAlert> : null}

          <Button
            variant="primary"
            type="submit"
            block
            disabled={!username.trim() || !password}
            loading={loginMutation.isPending}
            loadingLabel="Connexion…"
          >
            Se connecter
          </Button>
        </form>

        {import.meta.env.DEV ? (
          <Button
            variant="ghost"
            size="sm"
            className="login-dev-action"
            onClick={() => {
              throw new Error("Sentry test error — dev-only button")
            }}
          >
            Test Sentry (dev)
          </Button>
        ) : null}
      </section>
    </main>
  )
}
