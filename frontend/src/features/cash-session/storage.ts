export const SELECTED_CASH_REGISTER_KEY = "lopos.selectedCashRegisterId"

export function getStoredCashRegisterId(): string | null {
  return localStorage.getItem(SELECTED_CASH_REGISTER_KEY)
}

export function storeCashRegisterId(cashRegisterId: string): void {
  localStorage.setItem(SELECTED_CASH_REGISTER_KEY, cashRegisterId)
}
