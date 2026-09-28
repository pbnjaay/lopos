import type { LocalSale } from "../../db/types"
import type { PaymentMethod } from "../../types/api"

/** Ordre du pied de panier — il départage les égalités. */
const methodOrder: PaymentMethod[] = ["CASH", "WAVE", "ORANGE_MONEY"]

/**
 * Moyen de paiement dominant d'une session : celui qui porte la plus grosse
 * part de chaque vente, compté vente par vente. Le dernier moyen utilisé ne
 * suffisait pas — une seule vente Wave dans une boutique à 90 % d'espèces
 * basculait l'accent du pied de panier pour la vente suivante.
 */
export function dominantPaymentMethod(sales: LocalSale[]): PaymentMethod | null {
  const counts = new Map<PaymentMethod, number>()
  for (const sale of sales) {
    const main = sale.payments.reduce<LocalSale["payments"][number] | null>(
      (best, payment) => (best === null || payment.amount > best.amount ? payment : best),
      null,
    )
    if (main) counts.set(main.method, (counts.get(main.method) ?? 0) + 1)
  }
  let dominant: PaymentMethod | null = null
  for (const method of methodOrder) {
    const count = counts.get(method) ?? 0
    if (count > 0 && count > (dominant ? counts.get(dominant)! : 0)) dominant = method
  }
  return dominant
}
