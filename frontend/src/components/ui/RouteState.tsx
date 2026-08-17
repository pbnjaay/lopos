type RouteStateProps = {
  message: string
  error?: Error | null
  onRetry?: () => void
}

export function RouteState({ message, error, onRetry }: RouteStateProps) {
  return (
    <main className="setup-page">
      <section className="setup-card" aria-live="polite">
        <p className="brand">LoPOS</p>
        <h1>{error ? "Une erreur est survenue" : message}</h1>
        {error ? <p role="alert">{error.message}</p> : null}
        {error && onRetry ? (
          <button className="button button-primary" type="button" onClick={onRetry}>
            Réessayer
          </button>
        ) : null}
      </section>
    </main>
  )
}
