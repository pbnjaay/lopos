import type { CashRegister, CashSession } from "../types/api"
import { ApiError, apiRequest } from "./client"

export function getCashRegisters(): Promise<CashRegister[]> {
  return apiRequest<CashRegister[]>("cash-registers/")
}

export function getCashRegister(id: string): Promise<CashRegister> {
  return apiRequest<CashRegister>(`cash-registers/${encodeURIComponent(id)}/`)
}

export async function getCurrentCashSession(
  cashRegisterId: string,
): Promise<CashSession | null> {
  try {
    return await apiRequest<CashSession>(
      `cash-registers/${encodeURIComponent(cashRegisterId)}/current-session/`,
    )
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null
    throw error
  }
}
