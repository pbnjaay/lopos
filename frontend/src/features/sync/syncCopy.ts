import type { SyncOutcome } from "../../sync/syncEngine"

/** Formulation unique du résultat d'une synchronisation — partagée par la
 *  clôture, la page des ventes en attente et les notifications. */
export function describeSyncOutcome(outcome: SyncOutcome): string {
  if (outcome.attempted === 0) return "Aucune vente à synchroniser."
  const synced = `${outcome.synced} vente${outcome.synced > 1 ? "s" : ""} synchronisée${outcome.synced > 1 ? "s" : ""}`
  if (outcome.conflicts > 0) {
    return `${synced}, ${outcome.conflicts} à vérifier.`
  }
  return `${synced}.`
}
