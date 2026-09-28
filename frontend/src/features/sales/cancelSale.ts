import { cancelSale as cancelSaleOnServer } from "../../api/sales"
import { cancelPendingLocalSale } from "../../db/sales"

/**
 * Annule une vente, quel que soit son état de synchronisation au moment du
 * clic. Local d'abord : la grande majorité des annulations se font dans les
 * toutes premières secondes après l'encaissement, avant que la synchronisation
 * en tâche de fond n'ait eu le temps de passer — ce chemin ne demande jamais
 * de réseau. S'il s'avère que la vente a déjà synchronisé entre-temps (ou
 * qu'elle n'a jamais existé localement — vue via l'API), on retombe sur
 * l'annulation serveur, qui elle exige une connexion.
 */
export async function cancelSaleEverywhere(id: string): Promise<void> {
  const cancelledLocally = await cancelPendingLocalSale(id)
  if (cancelledLocally) return
  await cancelSaleOnServer(id)
}
