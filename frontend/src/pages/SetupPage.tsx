type SetupPageProps = {
  title: string
  nextStep: string
}

export function SetupPage({ title, nextStep }: SetupPageProps) {
  return (
    <main className="setup-page">
      <section className="setup-card" aria-labelledby="page-title">
        <p className="brand">LoPOS</p>
        <h1 id="page-title">{title}</h1>
        <p>{nextStep}</p>
        <p className="status">Étape 1 — socle frontend prêt</p>
      </section>
    </main>
  )
}
