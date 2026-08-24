import { useQuery } from "@tanstack/react-query"
import { Link, useParams } from "react-router-dom"

import { getSaleReceipt } from "../api/sales"
import { OperationalPageHeader } from "../components/layout/OperationalPageHeader"
import { ReceiptIcon, RotateCcwIcon } from "../components/ui/Icons"
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
    <main className="operational-page">
      <OperationalPageHeader
        backTo="/sales"
        backLabel="Retour aux ventes"
        eyebrow="Vente"
        title={`Ticket ${sale.id.slice(0, 8).toUpperCase()}`}
        context={`${sale.store.name} · ${sale.cash_register.name}`}
        actions={<>
          <Link className="button button-secondary button-small button-with-icon" to={`/sales/${sale.id}/receipt?cash_session_id=${ownSession!.id}&from=detail`}>
            <ReceiptIcon />
            <span>Voir le ticket</span>
          </Link>
          {canReturn ? <Link className="button button-primary button-small button-with-icon" to={`/sales/${sale.id}/return`}><RotateCcwIcon /><span>Effectuer un retour</span></Link> : null}
        </>}
      />
      <section className="operational-card sale-detail-card">
        <div className="sale-detail-meta" aria-label="Informations de la vente">
          <div><span>Date et heure</span><strong>{formatDateTime(sale.created_at)}</strong></div>
          <div><span>Caissier</span><strong>{sale.cashier.username}</strong></div>
          <div><span>Mode de paiement</span><strong>{{ CASH: "Espèces", WAVE: "Wave", ORANGE_MONEY: "Orange Money" }[sale.payment.method]}</strong></div>
        </div>
        <div className="sale-detail-section-heading">
          <h2>Articles vendus</h2>
          <span>{sale.items.length} article{sale.items.length > 1 ? "s" : ""}</span>
        </div>
        <ul className="sale-detail-items">
          {sale.items.map((item) => (
            <li key={item.id}>
              <div><strong>{item.product_name}</strong><span>{formatQuantity(backendQuantityToMilli(item.quantity), item.sale_unit ?? "UNIT")} × {formatBackendMoney(item.unit_price)}</span></div>
              <div><strong>{formatBackendMoney(item.line_total)}</strong>{Number(item.quantity_returned ?? 0) > 0 ? <span>Retourné : {formatQuantity(backendQuantityToMilli(item.quantity_returned!), item.sale_unit ?? "UNIT")}</span> : null}</div>
            </li>
          ))}
        </ul>
        <div className="sale-detail-summary">
          <p className="eyebrow">Récapitulatif</p>
          <dl className="sale-detail-totals">
            <div><dt>Total vendu</dt><dd>{formatBackendMoney(sale.total)}</dd></div>
            {Number(sale.returned_total ?? 0) > 0 ? <><div><dt>Déjà retourné</dt><dd>− {formatBackendMoney(sale.returned_total!)}</dd></div><div className="sale-detail-net"><dt>Total net</dt><dd>{formatBackendMoney(sale.net_total!)}</dd></div></> : null}
          </dl>
        </div>
        {!canReturn ? <p className="sale-fully-returned">Aucun article de cette vente ne peut encore être retourné.</p> : null}
      </section>
    </main>
  )
}
