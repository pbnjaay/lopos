/**
 * Provenance d'une consultation de vente, portée par `?from=` tout au long
 * du parcours vente → ticket → retour → ticket de retour.
 *
 * Le caissier atteint une vente depuis trois endroits, et « revenir » ne
 * veut pas dire la même chose selon lequel : depuis la caisse il doit
 * retrouver sa caisse, pas une liste de ventes. Un `backTo` figé le sortait
 * de son poste de travail à chaque vérification de ticket.
 *
 * `null` = arrivée depuis la liste des ventes, la destination par défaut.
 */
export type SaleOrigin = "pos" | "pending" | null

export function readSaleOrigin(searchParams: URLSearchParams): SaleOrigin {
  const from = searchParams.get("from")
  return from === "pos" || from === "pending" ? from : null
}

/** Reporte la provenance sur un lien sortant, en respectant sa query. */
export function withSaleOrigin(path: string, origin: SaleOrigin): string {
  if (!origin) return path
  return `${path}${path.includes("?") ? "&" : "?"}from=${origin}`
}

export function saleOriginBack(origin: SaleOrigin): { to: string; label: string } {
  if (origin === "pos") return { to: "/pos", label: "Retour au point de vente" }
  if (origin === "pending") {
    return { to: "/sales/pending", label: "Retour aux ventes en attente" }
  }
  return { to: "/sales", label: "Retour aux ventes" }
}
