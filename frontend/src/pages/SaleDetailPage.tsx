import { useQuery } from "@tanstack/react-query"
import { Link, useParams } from "react-router-dom"

import { getSaleReceipt } from "../api/sales"
import { RouteState } from "../components/ui/RouteState"
import { useCurrentUser } from "../features/auth/queries"
import { usePosSession } from "../features/cash-session/queries"
import { useNetworkStatus } from "../features/offline/useNetworkStatus"
import { formatDateTime } from "../utils/date"
import { formatBackendMoney } from "../utils/money"
import { backendQuantityToMilli, formatQuantity } from "../utils/quantity"

export function SaleDetailPage() {
  const { saleId } = useParams<{ saleId: string }>()
  const user = useCurrentUser().data!
  const { ownSession } = usePosSession(user)
  const online = useNetworkStatus()
  const saleQuery = useQuery({
    queryKey: ["sales", saleId, ownSession?.id],
    queryFn: () => getSaleReceipt(saleId!, ownSession!.id),
    enabled: Boolean(saleId && ownSession && online),
    retry: false,
  })

  if (!online) return <RouteState message="Le détail des ventes est indisponible hors connexion." />
  if (saleQuery.isLoading) return <RouteState message="Chargement de la vente…" />
  if (saleQuery.error || !saleQuery.data) return <RouteState message="Vente introuvable dans cette boutique." error={saleQuery.error} onRetry={() => void saleQuery.refetch()} />

  const sale = saleQuery.data
  const canReturn = sale.status === "COMPLETED" && sale.items.some((item) => Number(item.quantity_returnable ?? item.quantity) > 0)

  return (
    <main className="sales-page">
      <nav className="sale-detail-actions">
        <Link className="text-button" to="/sales">Retour aux ventes</Link>
        <div>
          <Link className="button button-secondary button-small" to={`/sales/${sale.id}/receipt?cash_session_id=${ownSession!.id}`}>Voir le ticket</Link>
          {canReturn ? <Link className="button button-primary button-small" to={`/sales/${sale.id}/return`}>Effectuer un retour</Link> : null}
        </div>
      </nav>
      <section className="sale-detail-card">
        <p className="eyebrow">Ticket {sale.id.slice(0, 8).toUpperCase()}</p>
        <h1>Détail de la vente</h1>
        <div className="sale-detail-meta">
          <span>{formatDateTime(sale.created_at)}</span>
          <span>{sale.store.name}</span>
          <span>{sale.cash_register.name}</span>
          <span>Caissier : {sale.cashier.username}</span>
        </div>
        <ul className="sale-detail-items">
          {sale.items.map((item) => (
            <li key={item.id}>
              <div><strong>{item.product_name}</strong><span>{formatQuantity(backendQuantityToMilli(item.quantity), item.sale_unit ?? "UNIT")} × {formatBackendMoney(item.unit_price)}</span></div>
              <div><strong>{formatBackendMoney(item.line_total)}</strong>{Number(item.quantity_returned ?? 0) > 0 ? <span>Retourné : {formatQuantity(backendQuantityToMilli(item.quantity_returned!), item.sale_unit ?? "UNIT")}</span> : null}</div>
            </li>
          ))}
        </ul>
        <dl className="sale-detail-totals">
          <div><dt>Total vendu</dt><dd>{formatBackendMoney(sale.total)}</dd></div>
          {Number(sale.returned_total ?? 0) > 0 ? <><div><dt>Déjà retourné</dt><dd>− {formatBackendMoney(sale.returned_total!)}</dd></div><div className="sale-detail-net"><dt>Total net</dt><dd>{formatBackendMoney(sale.net_total!)}</dd></div></> : null}
        </dl>
        {!canReturn ? <p className="sale-fully-returned">Aucun article de cette vente ne peut encore être retourné.</p> : null}
      </section>
    </main>
  )
}
