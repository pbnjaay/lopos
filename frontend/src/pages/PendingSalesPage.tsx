import { useQuery } from "@tanstack/react-query"
import { Link } from "react-router-dom"

import { listPendingLocalSales } from "../db/sales"
import { formatDateTime } from "../utils/date"
import { formatMoney } from "../utils/money"

const paymentLabels = {
  CASH: "Espèces",
  WAVE: "Wave",
  ORANGE_MONEY: "Orange Money",
} as const

export function PendingSalesPage() {
  const pendingSalesQuery = useQuery({
    queryKey: ["pending-local-sales"],
    queryFn: () => listPendingLocalSales(),
  })
  const sales = pendingSalesQuery.data ?? []

  return (
    <main className="content-page">
      <section className="setup-card" aria-labelledby="pending-sales-title">
        <p className="eyebrow">Hors ligne</p>
        <h1 id="pending-sales-title">Ventes en attente</h1>
        <p className="muted">
          Ces ventes ont été enregistrées localement et seront synchronisées dès la
          reconnexion.
        </p>

        {pendingSalesQuery.isLoading ? <p className="muted">Chargement…</p> : null}

        {!pendingSalesQuery.isLoading && sales.length === 0 ? (
          <p className="muted">Aucune vente en attente de synchronisation.</p>
        ) : null}

        {sales.length > 0 ? (
          <ul className="pending-sales-list">
            {sales.map((sale) => (
              <li key={sale.id}>
                <Link
                  className="pending-sale-row"
                  to={`/sales/${encodeURIComponent(sale.id)}/receipt`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <span>{formatDateTime(sale.createdAt)}</span>
                  <strong>{formatMoney(sale.total)}</strong>
                  <span>{paymentLabels[sale.payment.method]}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : null}

        <Link className="text-button" to="/pos">
          Retour au point de vente
        </Link>
      </section>
    </main>
  )
}
