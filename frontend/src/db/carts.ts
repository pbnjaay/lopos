import { db, type PosDatabase } from "./database"
import type { LocalCart, LocalCartItem } from "./types"
import { loadCartForSession, saveCartForSession } from "../features/cart/cartStorage"

export class ActiveCartNotEmptyError extends Error {
  constructor() {
    super("Le panier en cours doit être mis en attente ou vidé avant de reprendre un autre panier.")
    this.name = "ActiveCartNotEmptyError"
  }
}

export class HeldCartNotFoundError extends Error {
  constructor() {
    super("Ce panier en attente n'existe plus.")
    this.name = "HeldCartNotFoundError"
  }
}

function newCart(cashSessionId: string, items: LocalCartItem[] = []): LocalCart {
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    cashSessionId,
    status: "ACTIVE",
    items,
    createdAt: now,
    updatedAt: now,
    heldAt: null,
  }
}

async function findActiveCart(
  cashSessionId: string,
  database: PosDatabase,
): Promise<LocalCart | undefined> {
  return database.carts
    .where("[cashSessionId+status]")
    .equals([cashSessionId, "ACTIVE"])
    .first()
}

/**
 * Returns the session's active cart, creating it on first use. A cart left
 * over in `localStorage` (pre-Dexie cart storage) is adopted once and the
 * legacy key cleared, so nothing already scanned by a cashier is lost.
 */
export async function ensureActiveCart(
  cashSessionId: string,
  database: PosDatabase = db,
): Promise<LocalCart> {
  return database.transaction("rw", database.carts, async () => {
    const existing = await findActiveCart(cashSessionId, database)
    if (existing) return existing

    const legacyItems = loadCartForSession(cashSessionId)
    const cart = newCart(cashSessionId, legacyItems)
    await database.carts.add(cart)
    if (legacyItems.length > 0) saveCartForSession(cashSessionId, [])
    return cart
  })
}

export async function saveActiveCartItems(
  cashSessionId: string,
  items: LocalCartItem[],
  database: PosDatabase = db,
): Promise<void> {
  await database.transaction("rw", database.carts, async () => {
    const cart = await findActiveCart(cashSessionId, database)
    const target = cart ?? newCart(cashSessionId)
    await database.carts.put({ ...target, items, updatedAt: new Date().toISOString() })
  })
}

export async function listHeldCarts(
  cashSessionId: string,
  database: PosDatabase = db,
): Promise<LocalCart[]> {
  const carts = await database.carts
    .where("[cashSessionId+status]")
    .equals([cashSessionId, "HELD"])
    .toArray()
  return carts.sort((a, b) => (b.heldAt ?? "").localeCompare(a.heldAt ?? ""))
}

export async function countHeldCarts(
  cashSessionId: string,
  database: PosDatabase = db,
): Promise<number> {
  return database.carts
    .where("[cashSessionId+status]")
    .equals([cashSessionId, "HELD"])
    .count()
}

/**
 * Moves the active cart to HELD and immediately opens a fresh empty active
 * cart, so a session always has exactly one ACTIVE row to append to.
 */
export async function holdActiveCart(
  cashSessionId: string,
  database: PosDatabase = db,
): Promise<void> {
  await database.transaction("rw", database.carts, async () => {
    const cart = await findActiveCart(cashSessionId, database)
    if (!cart || cart.items.length === 0) return

    const now = new Date().toISOString()
    await database.carts.put({ ...cart, status: "HELD", heldAt: now, updatedAt: now })
    await database.carts.add(newCart(cashSessionId))
  })
}

/**
 * Swaps the session's active cart for a held one, using the caller-supplied
 * `revalidatedItems` (never the held cart's raw snapshot) so stale stock can
 * never re-enter the active cart. Fails if the active cart is not empty —
 * the caller must hold or clear it first.
 */
export async function resumeHeldCart(
  cartId: string,
  cashSessionId: string,
  revalidatedItems: LocalCartItem[],
  database: PosDatabase = db,
): Promise<LocalCart> {
  return database.transaction("rw", database.carts, async () => {
    const held = await database.carts.get(cartId)
    if (!held || held.cashSessionId !== cashSessionId || held.status !== "HELD") {
      throw new HeldCartNotFoundError()
    }
    const active = await findActiveCart(cashSessionId, database)
    if (!active || active.items.length > 0) throw new ActiveCartNotEmptyError()

    const resumed: LocalCart = {
      ...active,
      items: revalidatedItems,
      updatedAt: new Date().toISOString(),
    }
    await database.carts.put(resumed)
    await database.carts.delete(cartId)
    return resumed
  })
}

export async function deleteHeldCart(
  cartId: string,
  cashSessionId: string,
  database: PosDatabase = db,
): Promise<void> {
  await database.transaction("rw", database.carts, async () => {
    const cart = await database.carts.get(cartId)
    if (!cart || cart.cashSessionId !== cashSessionId || cart.status !== "HELD") return
    await database.carts.delete(cartId)
  })
}

export type SessionCartBlockers = {
  activeItemCount: number
  heldCount: number
}

/** Used by the cash-close guard: an unfinished sale must never be discarded by closing the register. */
export async function getSessionCartBlockers(
  cashSessionId: string,
  database: PosDatabase = db,
): Promise<SessionCartBlockers> {
  const [active, heldCount] = await Promise.all([
    findActiveCart(cashSessionId, database),
    countHeldCarts(cashSessionId, database),
  ])
  return { activeItemCount: active?.items.length ?? 0, heldCount }
}
