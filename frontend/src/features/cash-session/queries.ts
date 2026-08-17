import { useQuery } from "@tanstack/react-query"

import { isApiUnavailable } from "../../api/client"
import { getCashRegisters, getCurrentCashSession } from "../../api/cashRegisters"
import {
  getLocalCashSessionForRegister,
  localSessionToCashRegister,
  localSessionToCashSession,
  markLocalCashSessionClosed,
  saveLocalCashSession,
} from "../../db/sessions"
import type { CashRegister, CurrentUser } from "../../types/api"
import {
  SELECTED_CASH_REGISTER_KEY,
  getStoredCashRegisterId,
  storeCashRegisterId,
} from "./storage"

export { SELECTED_CASH_REGISTER_KEY, getStoredCashRegisterId, storeCashRegisterId }

export function resolveCashRegister(
  registers: CashRegister[],
  preferredId: string | null,
): CashRegister | null {
  const activeRegisters = registers.filter((register) => register.is_active)
  const preferred = activeRegisters.find((register) => register.id === preferredId)

  if (preferred) return preferred
  return activeRegisters.length === 1 ? (activeRegisters[0] ?? null) : null
}

export function usePosSession(
  cashier: Pick<CurrentUser, "id" | "username" | "first_name">,
) {
  const preferredRegisterId = getStoredCashRegisterId()
  const localSessionQuery = useQuery({
    queryKey: ["local-cash-session", preferredRegisterId],
    queryFn: () => getLocalCashSessionForRegister(preferredRegisterId!),
    enabled: preferredRegisterId !== null,
    staleTime: Infinity,
  })
  const registersQuery = useQuery({
    queryKey: ["cash-registers"],
    queryFn: getCashRegisters,
    staleTime: 30_000,
  })
  const localSession = localSessionQuery.data ?? null
  const fallbackRegister = localSession
    ? localSessionToCashRegister(localSession)
    : null
  const registers = registersQuery.data ?? (fallbackRegister ? [fallbackRegister] : [])
  const selectedRegister = resolveCashRegister(
    registers,
    preferredRegisterId,
  )
  const sessionQuery = useQuery({
    queryKey: ["cash-registers", selectedRegister?.id, "current-session"],
    queryFn: async () => {
      try {
        const session = await getCurrentCashSession(selectedRegister!.id)
        if (session) {
          try {
            await saveLocalCashSession(session, selectedRegister!, cashier)
          } catch {
            // A cache failure must not hide a session confirmed by Django.
          }
        } else {
          try {
            await markLocalCashSessionClosed(selectedRegister!.id)
          } catch {
            // A cache failure must not hide the authoritative server state.
          }
        }
        return session
      } catch (error) {
        if (!isApiUnavailable(error)) throw error
        const cachedSession = await getLocalCashSessionForRegister(selectedRegister!.id)
        return cachedSession ? localSessionToCashSession(cachedSession) : null
      }
    },
    enabled: selectedRegister !== null,
    retry: false,
  })
  const currentSession = sessionQuery.data ?? null
  const ownSession = currentSession?.cashier_id === cashier.id ? currentSession : null
  const hasUsableLocalSession =
    localSession !== null &&
    localSession.status === "OPEN" &&
    localSession.cashierId === cashier.id
  const registersError =
    registersQuery.error && !hasUsableLocalSession ? registersQuery.error : null
  const localSessionError =
    localSessionQuery.error && !registersQuery.data ? localSessionQuery.error : null

  return {
    registers,
    selectedRegister,
    currentSession,
    ownSession,
    localSession,
    isLoading:
      (registersQuery.isLoading && localSessionQuery.isLoading) ||
      (selectedRegister !== null && sessionQuery.isLoading),
    error: localSessionError ?? registersError ?? sessionQuery.error,
    refetch: async () => {
      await Promise.all([registersQuery.refetch(), localSessionQuery.refetch()])
      if (selectedRegister) await sessionQuery.refetch()
    },
  }
}
