/**
 * Le détail d'une vente et le formulaire de retour consomment exactement le
 * même reçu. Une clé commune leur permet de partager la donnée et d'éviter un
 * écran de chargement lors du passage de l'un à l'autre.
 */
export function saleReceiptQueryKey(
  saleId: string | undefined,
  cashSessionId: string | undefined,
) {
  return ["sales", "detail", saleId, cashSessionId] as const;
}

/** Donnée complète nécessaire à l'écran et à l'impression d'un retour. */
export function saleReturnReceiptQueryKey(
  returnId: string | undefined,
  cashSessionId: string | undefined,
) {
  return ["returns", returnId, cashSessionId, "receipt"] as const;
}
