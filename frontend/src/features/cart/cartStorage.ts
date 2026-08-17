import type { CartItem } from "./cartState"

const STORAGE_PREFIX = "lopos.cart."

function storageKey(cashSessionId: string): string {
  return `${STORAGE_PREFIX}${cashSessionId}`
}

/** The cart is scoped to a cash session so a refresh never restores a previous session's sale. */
export function loadCartForSession(cashSessionId: string | null): CartItem[] {
  if (!cashSessionId) return []

  try {
    const raw = localStorage.getItem(storageKey(cashSessionId))
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as CartItem[]) : []
  } catch {
    return []
  }
}

export function saveCartForSession(cashSessionId: string | null, items: CartItem[]): void {
  if (!cashSessionId) return

  try {
    if (items.length === 0) {
      localStorage.removeItem(storageKey(cashSessionId))
    } else {
      localStorage.setItem(storageKey(cashSessionId), JSON.stringify(items))
    }
  } catch {
    // localStorage may be unavailable (private browsing); the cart still works in memory.
  }
}
