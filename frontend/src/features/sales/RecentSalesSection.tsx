import { useQuery } from "@tanstack/react-query"
import { Link } from "react-router-dom"

import { ChevronRightIcon } from "../../components/ui/Icons"
import { Money } from "../../components/ui/Money"
import { listRecentLocalSales } from "../../db/sales"
import { withSaleOrigin } from "./origin"
import { formatTime } from "../../utils/date"

type RecentSalesSectionProps = {
  cashSessionId: string | null
}

export function recentSalesQueryKey(cashSessionId: string | null) {
  return ["recent-local-sales", cashSessionId] as const
}

/**
 * Les trois dernières ventes, dans le POS. Réimprimer un ticket ou vérifier
 * un encaissement fait partie du travail de caisse, pas d'un back-office :
 * le caissier ne devrait pas avoir à quitter son poste pour ça. Lecture
 * Dexie, donc valable hors ligne, et volontairement limitée à trois — au
 * delà, c'est la page « Ventes » qui répond.
 */
export function RecentSalesSection({ cashSessionId }: RecentSalesSectionProps) {
  const salesQuery = useQuery({
    queryKey: recentSalesQueryKey(cashSessionId),
    queryFn: () => listRecentLocalSales(cashSessionId!),
    enabled: cashSessionId !== null,
  })
  const sales = salesQuery.data ?? []
  if (sales.length === 0) return null

  // Le détail de vente est le vrai point d'entrée : il porte la
  // réimpression, le retour et la vérification. Il vit côté serveur, donc
  // une vente pas encore synchronisée n'y existe pas — pour celle-là, seul
  // le ticket local est consultable, et il l'est même hors ligne.
  function saleDestination(sale: (typeof sales)[number]): string {
    if (sale.status === "SYNCED" && sale.serverId) {
      return withSaleOrigin(`/sales/${encodeURIComponent(sale.serverId)}`, "pos")
    }
    return withSaleOrigin(`/sales/${encodeURIComponent(sale.id)}/receipt`, "pos")
  }

  return (
    <section className="pos-rail-section" aria-labelledby="recent-sales-title">
      <div className="pos-rail-section-header">
        <h2 id="recent-sales-title">Dernières ventes</h2>
        <Link className="pos-rail-link" to="/sales">
          Toutes
        </Link>
      </div>
      {/* De vraies lignes separees par un filet, pas trois cartes dans un
          panneau deja bordee : l'historique se lit, il ne se manipule pas. */}
      <ul className="pos-rail-lines">
        {sales.map((sale) => (
          <li key={sale.id}>
            <Link
              className="pos-rail-line"
              to={saleDestination(sale)}
              aria-label={`Vente de ${formatTime(sale.createdAt)} — ${sale.items.length} article${sale.items.length > 1 ? "s" : ""}`}
            >
              <span className="pos-rail-line-time">{formatTime(sale.createdAt)}</span>
              <span className="pos-rail-line-label">
                {sale.items.length} article{sale.items.length > 1 ? "s" : ""}
              </span>
              <strong className="pos-rail-line-amount">
                <Money value={sale.total} />
              </strong>
              <ChevronRightIcon />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
