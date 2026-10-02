import { useQuery } from "@tanstack/react-query"

import { getCurrentUser, login, logout, type LoginInput } from "../../api/auth"
import { isApiUnavailable } from "../../api/client"
import { getLocalCashSessionForRegister, localSessionToCurrentUser } from "../../db/sessions"
import {
  bindTerminalToUser,
  forgetAuthenticatedUser,
  getAuthenticatedUser,
  getTerminalOrganizationId,
} from "../../db/tenancy"
import type { CurrentUser } from "../../types/api"
import { UserFacingError } from "../../utils/errors"
import { getStoredCashRegisterId } from "../cash-session/storage"

export const currentUserQueryKey = ["auth", "me"] as const

export class OfflineCashSessionUnavailableError extends UserFacingError {
  constructor() {
    super(
      "Connexion requise",
      "Aucune session de caisse disponible hors ligne pour ce poste. Reconnectez-vous à Internet pour vous connecter ou ouvrir une caisse.",
      { canRetry: true },
    )
    this.name = "OfflineCashSessionUnavailableError"
  }
}

/**
 * Le compte confirmé par le serveur entre sur le poste : celui-ci est lié à
 * son commerce (et effacé s'il servait un autre commerce). Si le poste doit
 * d'abord envoyer les ventes d'un autre commerce, la session tout juste
 * ouverte est refermée : aucun compte ne travaille sur un poste qui ne lui
 * est pas réservé.
 */
async function admitOnTerminal(user: CurrentUser): Promise<CurrentUser> {
  try {
    await bindTerminalToUser(user)
  } catch (error) {
    await logout().catch(() => undefined)
    throw error
  }
  return user
}

export async function signIn(input: LoginInput): Promise<CurrentUser> {
  return admitOnTerminal(await login(input))
}

export async function getCurrentUserWithOfflineFallback(): Promise<CurrentUser | null> {
  let user: CurrentUser | null
  try {
    user = await getCurrentUser()
  } catch (error) {
    if (!isApiUnavailable(error)) throw error
    return offlineUser()
  }
  if (user === null) {
    // Le serveur ne reconnaît plus la session (expirée, compte ou commerce
    // désactivé) : le poste ne doit plus pouvoir la rejouer hors ligne.
    await forgetAuthenticatedUser()
    return null
  }
  return admitOnTerminal(user)
}

/**
 * Hors ligne, seul le dernier compte authentifié en ligne — et pas déconnecté
 * depuis — retrouve sa propre caisse ouverte, dans un magasin où il
 * travaille, sur un poste de son commerce. Une déconnexion verrouille donc
 * le poste jusqu'à la prochaine connexion en ligne.
 */
async function offlineUser(): Promise<CurrentUser> {
  const authenticated = await getAuthenticatedUser()
  const cashRegisterId = getStoredCashRegisterId()
  const localSession =
    authenticated && cashRegisterId ? await getLocalCashSessionForRegister(cashRegisterId) : null
  const terminalOrganizationId = await getTerminalOrganizationId()
  const usable =
    authenticated !== null &&
    localSession !== null &&
    localSession.cashierId === authenticated.id &&
    authenticated.organizationId === terminalOrganizationId &&
    (localSession.organizationId ?? authenticated.organizationId) === authenticated.organizationId &&
    authenticated.storeIds.includes(localSession.storeId)
  if (!usable) throw new OfflineCashSessionUnavailableError()
  return localSessionToCurrentUser(localSession!, authenticated!)
}

export function useCurrentUser() {
  return useQuery({
    queryKey: currentUserQueryKey,
    queryFn: getCurrentUserWithOfflineFallback,
    retry: false,
    staleTime: 30_000,
  })
}
