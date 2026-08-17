import { Link } from "react-router-dom"

export function CloseCashSessionPage() {
  return (
    <main className="content-page">
      <section className="setup-card" aria-labelledby="close-session-title">
        <p className="eyebrow">Fin de journée</p>
        <h1 id="close-session-title">Clôturer la caisse</h1>
        <p className="muted">
          Vérifiez le résumé de la session avant de compter le contenu du tiroir-caisse.
        </p>
        <Link className="text-button close-session-back-link" to="/pos">
          Retour au point de vente
        </Link>
      </section>
    </main>
  )
}
