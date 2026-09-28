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

export type SyncNotice = {
  tone: "success" | "info" | "warning"
  title: string
  description: string
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count > 1 ? "s" : ""}`
}

/**
 * Toast de fin de synchronisation demandée à la main. Le ton dépend de ce
 * qui reste réellement en attente après coup, pas seulement du résultat : un
 * serveur injoignable renvoie un résultat vide, qui n'est pas un succès.
 */
export function describeSyncNotice(outcome: SyncOutcome, remaining: number): SyncNotice {
  const stillPending = remaining > 0
    ? `${plural(remaining, "vente")} encore en attente, réessayez dans un instant.`
    : ""

  if (outcome.conflicts > 0) {
    return {
      tone: "warning",
      title: `${plural(outcome.conflicts, "vente")} à vérifier`,
      description: [describeSyncOutcome(outcome), stillPending].filter(Boolean).join(" "),
    }
  }
  if (remaining > 0) {
    return {
      tone: "warning",
      title: "Synchronisation incomplète",
      description: outcome.synced > 0
        ? `${describeSyncOutcome(outcome)} ${stillPending}`
        : `Le serveur n’a pas répondu. ${stillPending}`,
    }
  }
  if (outcome.attempted === 0) {
    return {
      tone: "info",
      title: "Rien à synchroniser",
      description: "Toutes les ventes sont déjà envoyées.",
    }
  }
  return { tone: "success", title: "Synchronisation terminée", description: describeSyncOutcome(outcome) }
}
