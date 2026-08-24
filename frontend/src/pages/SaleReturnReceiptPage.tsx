import { useQuery } from "@tanstack/react-query"
import { Link, useParams } from "react-router-dom"
import { getSaleReturn } from "../api/sales"
import { RouteState } from "../components/ui/RouteState"
import { formatDateTime } from "../utils/date"
import { formatBackendMoney } from "../utils/money"

export function SaleReturnReceiptPage() {
  const { returnId } = useParams<{ returnId: string }>()
  const query = useQuery({ queryKey: ["returns", returnId], queryFn: () => getSaleReturn(returnId!), enabled: Boolean(returnId) })
  if (query.isLoading) return <RouteState message="Chargement du ticket de retour…" />
  if (query.error || !query.data) return <RouteState message="Ticket de retour introuvable." error={query.error} />
  const value = query.data
  return <main className="receipt-page"><nav className="receipt-actions no-print"><Link className="text-button" to="/pos">Retour au POS</Link><button className="button button-primary button-small" onClick={() => window.print()}>Imprimer</button></nav><article className="receipt"><header className="receipt-heading"><h1>RETOUR</h1><p>Référence : {value.reference}</p><p>Vente originale : {value.original_sale_id}</p><p>{formatDateTime(value.created_at)}</p></header><ul className="receipt-items">{value.items.map((item) => <li key={item.id}><strong>{item.product_name}</strong><div><span>{item.quantity} × {formatBackendMoney(item.unit_price)}</span><span>{formatBackendMoney(item.refund_amount)}</span></div><small>Remis en stock : {item.restock ? "Oui" : "Non"}</small></li>)}</ul><dl className="receipt-totals"><div className="receipt-total"><dt>TOTAL REMBOURSÉ</dt><dd>{formatBackendMoney(value.total_refund)}</dd></div><div><dt>Mode</dt><dd>{value.payment_method}</dd></div></dl></article></main>
}
