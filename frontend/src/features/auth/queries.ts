import { useQuery } from "@tanstack/react-query"

import { getCurrentUser } from "../../api/auth"
import { isApiUnavailable } from "../../api/client"
import {
  getLocalCashSessionForRegister,
  localSessionToCurrentUser,
} from "../../db/sessions"
import { getStoredCashRegisterId } from "../cash-session/storage"

export const currentUserQueryKey = ["auth", "me"] as const

export class OfflineCashSessionUnavailableError extends Error {
  constructor() {
    super(
      "Aucune session de caisse disponible hors ligne. Reconnectez-vous à Internet pour ouvrir une caisse.",
    )
    this.name = "OfflineCashSessionUnavailableError"
  }
}

export async function getCurrentUserWithOfflineFallback() {
  try {
    return await getCurrentUser()
  } catch (error) {
    if (!isApiUnavailable(error)) throw error

    const cashRegisterId = getStoredCashRegisterId()
    const localSession = cashRegisterId
      ? await getLocalCashSessionForRegister(cashRegisterId)
      : null
    if (!localSession) throw new OfflineCashSessionUnavailableError()
    return localSessionToCurrentUser(localSession)
  }
}

export function useCurrentUser() {
  return useQuery({
    queryKey: currentUserQueryKey,
    queryFn: getCurrentUserWithOfflineFallback,
    retry: false,
    staleTime: 30_000,
  })
}
