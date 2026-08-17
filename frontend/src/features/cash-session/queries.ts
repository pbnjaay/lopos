import { useQuery } from "@tanstack/react-query"

import { getCashRegisters, getCurrentCashSession } from "../../api/cashRegisters"
import type { CashRegister } from "../../types/api"

export const SELECTED_CASH_REGISTER_KEY = "lopos.selectedCashRegisterId"

export function getStoredCashRegisterId(): string | null {
  return localStorage.getItem(SELECTED_CASH_REGISTER_KEY)
}

export function storeCashRegisterId(cashRegisterId: string): void {
  localStorage.setItem(SELECTED_CASH_REGISTER_KEY, cashRegisterId)
}

export function resolveCashRegister(
  registers: CashRegister[],
  preferredId: string | null,
): CashRegister | null {
  const activeRegisters = registers.filter((register) => register.is_active)
  const preferred = activeRegisters.find((register) => register.id === preferredId)

  if (preferred) return preferred
  return activeRegisters.length === 1 ? (activeRegisters[0] ?? null) : null
}

export function usePosSession(cashierId: number) {
  const registersQuery = useQuery({
    queryKey: ["cash-registers"],
    queryFn: getCashRegisters,
    staleTime: 30_000,
  })
  const selectedRegister = resolveCashRegister(
    registersQuery.data ?? [],
    getStoredCashRegisterId(),
  )
  const sessionQuery = useQuery({
    queryKey: ["cash-registers", selectedRegister?.id, "current-session"],
    queryFn: () => getCurrentCashSession(selectedRegister!.id),
    enabled: selectedRegister !== null,
    retry: false,
  })
  const currentSession = sessionQuery.data ?? null
  const ownSession = currentSession?.cashier_id === cashierId ? currentSession : null

  return {
    registers: registersQuery.data ?? [],
    selectedRegister,
    currentSession,
    ownSession,
    isLoading:
      registersQuery.isLoading || (selectedRegister !== null && sessionQuery.isLoading),
    error: registersQuery.error ?? sessionQuery.error,
    refetch: async () => {
      await registersQuery.refetch()
      if (selectedRegister) await sessionQuery.refetch()
    },
  }
}
