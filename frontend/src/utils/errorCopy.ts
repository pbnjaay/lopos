import { ApiError, NetworkError } from "../api/client"

/**
 * Contexte métier de l'écran qui a échoué. Il décide de la formulation :
 * un POS qui sait vendre hors ligne ne dit pas « vérifiez votre connexion »,
 * il dit ce que le caissier peut faire malgré tout.
 */
export type ErrorContext =
  | "catalogue"
  | "historique"
  | "vente"
  | "retour"
  | "cloture"
  | "rapport"
  | "ticket"
  | "session"
  | "generique"

export type ErrorCopy = {
  title: string
  description: string
  canRetry: boolean
}

const offlineDescription: Record<ErrorContext, string> = {
  catalogue:
    "Connectez cet appareil à Internet une première fois pour préparer le catalogue.",
  historique: "L'historique redeviendra consultable dès le retour de la connexion.",
  vente: "Le détail des ventes redeviendra consultable dès le retour de la connexion.",
  retour: "Un retour marchandise nécessite une connexion. Vous pouvez continuer à vendre.",
  cloture: "La clôture nécessite une connexion. Vous pouvez continuer à vendre.",
  rapport: "Le rapport redeviendra consultable dès le retour de la connexion.",
  ticket: "Le ticket redeviendra consultable dès le retour de la connexion.",
  session: "Reconnectez-vous pour vérifier votre session de caisse.",
  generique: "Réessayez dans un instant.",
}

const notFoundTitle: Record<ErrorContext, string> = {
  catalogue: "Produit introuvable",
  historique: "Vente introuvable",
  vente: "Vente introuvable",
  retour: "Vente introuvable",
  cloture: "Session introuvable",
  rapport: "Rapport introuvable",
  ticket: "Ticket introuvable",
  session: "Session introuvable",
  generique: "Élément introuvable",
}

/**
 * Traduit n'importe quelle erreur en message affichable par un caissier.
 * Aucun `TypeError`, `NetworkError`, `HTTP 500` ni `Failed to fetch` ne
 * peut sortir d'ici — seuls les messages métier renvoyés par l'API pour
 * une erreur de validation sont repris tels quels.
 */
export function describeError(
  error: unknown,
  context: ErrorContext = "generique",
): ErrorCopy {
  if (error instanceof NetworkError) {
    return {
      title: "Mode hors ligne",
      description: offlineDescription[context],
      canRetry: true,
    }
  }

  if (error instanceof ApiError) {
    if (error.status >= 500) {
      return {
        title: "Service momentanément indisponible",
        description: "Le serveur ne répond pas correctement. Réessayez dans un instant.",
        canRetry: true,
      }
    }
    // Une erreur métier structurée (`code` + `message`) est déjà rédigée pour
    // le caissier par le backend : la reformuler ferait perdre l'information.
    // Un simple `detail` de DRF, lui, reste du jargon technique.
    if (error.code && typeof error.body?.message === "string") {
      return { title: "Opération refusée", description: error.body.message, canRetry: false }
    }
    if (error.status === 401 || error.status === 403) {
      return {
        title: "Accès refusé",
        description:
          "Votre session a expiré ou vous n'avez pas les droits nécessaires. Reconnectez-vous.",
        canRetry: false,
      }
    }
    if (error.status === 404) {
      return {
        title: notFoundTitle[context],
        description: "Vérifiez la référence, ou revenez à l'écran précédent.",
        canRetry: false,
      }
    }
    return {
      title: "Opération refusée",
      description:
        "Cette action n'a pas pu être effectuée. Vérifiez les informations saisies.",
      canRetry: false,
    }
  }

  return {
    title: "Un problème inattendu est survenu",
    description: "Réessayez. Si le problème persiste, prévenez un responsable.",
    canRetry: true,
  }
}

/** Variante courte, pour un message inline ou un toast. */
export function describeErrorShort(error: unknown, context: ErrorContext = "generique"): string {
  const { title, description } = describeError(error, context)
  return description || title
}
