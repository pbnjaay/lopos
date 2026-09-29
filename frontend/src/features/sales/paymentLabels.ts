import type { PaymentMethod } from "../../types/api"

export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  CASH: "Espèces",
  WAVE: "Wave",
  ORANGE_MONEY: "Orange Money",
}

/** Libellé de la part mise au cahier, à côté des vrais moyens de paiement. */
export const CREDIT_LABEL = "Cahier"

/**
 * « Espèces + Wave + Cahier » : ce qui a couvert la vente. Le cahier n'est
 * pas un paiement, mais pour le caissier c'est une façon dont la vente a été
 * réglée — une vente entièrement à crédit n'a sinon aucun libellé.
 */
export function describeSettlement(
  payments: ReadonlyArray<{ method: PaymentMethod }>,
  creditAmount: number,
): string {
  const labels = payments.map((payment) => PAYMENT_LABELS[payment.method])
  if (creditAmount > 0) labels.push(CREDIT_LABEL)
  return labels.join(" + ")
}
