import type { PaymentMethod } from "../../types/api"

const LAST_PAYMENT_METHOD_KEY = "lopos.lastPaymentMethod"

export function getLastPaymentMethod(): PaymentMethod | null {
  const value = localStorage.getItem(LAST_PAYMENT_METHOD_KEY)
  return value === "CASH" || value === "WAVE" || value === "ORANGE_MONEY" ? value : null
}

export function storeLastPaymentMethod(method: PaymentMethod): void {
  localStorage.setItem(LAST_PAYMENT_METHOD_KEY, method)
}
