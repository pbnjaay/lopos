import { cancelSale as cancelSaleOnServer } from "../../api/sales"
import { getLocalSaleById } from "../../db/sales"
import { syncPendingSales } from "../../sync/syncEngine"
import { UserFacingError } from "../../utils/errors"

export class CancellationNeedsConnectionError extends UserFacingError {
  constructor() {
    super(
      "Connexion requise",
      "Une vente ne s’annule qu’en ligne : elle doit d’abord arriver au serveur, qui garde la trace de l’annulation. Réessayez au retour de la connexion.",
      { canRetry: true },
    )
    this.name = "CancellationNeedsConnectionError"
  }
}

export type CancelSaleInput = {
  reason: string
  /** Validation d'un gérant, quand le serveur l'exige. */
  approvalToken?: string | null
}

/**
 * Annule une vente, qu'elle ait déjà été synchronisée ou non. Une vente
 * encore en attente sur le poste est d'abord envoyée au serveur : jamais
 * d'effacement local, qui ferait disparaître sans trace une vente déjà
 * encaissée. L'annulation elle-même a toujours lieu sur le serveur (motif,
 * auteur, validation éventuelle d'un gérant) — elle exige donc la connexion.
 */
export async function cancelSaleEverywhere(id: string, input: CancelSaleInput): Promise<void> {
  const local = await getLocalSaleById(id)
  if (local?.status === "PENDING_SYNC") {
    await syncPendingSales()
    const afterSync = await getLocalSaleById(id)
    if (afterSync?.status === "PENDING_SYNC") throw new CancellationNeedsConnectionError()
  }
  await cancelSaleOnServer(local?.serverId ?? id, input)
}
