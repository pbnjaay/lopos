import { db, type PosDatabase } from "../../db/database"
import type { CartItem } from "./cartState"

export type CartRevalidationChange = {
  name: string
  saleUnit: "UNIT" | "KG"
  fromMilli: number
  toMilli: number
}

export type CartRevalidationResult = {
  items: CartItem[]
  /** Products no longer sellable (deactivated, deleted, or out of stock). */
  removed: string[]
  /** Products kept, but clamped to the stock actually available now. */
  reduced: CartRevalidationChange[]
}

/**
 * Re-checks a cart snapshot against the live local catalog before it can
 * become the active cart again. A held cart may be hours old: stock may have
 * sold out, or the product may have been deactivated in the meantime. Prices
 * (catalog and overridden) are never touched here — only availability.
 */
export async function revalidateCartItems(
  items: CartItem[],
  storeId: string,
  database: PosDatabase = db,
): Promise<CartRevalidationResult> {
  const removed: string[] = []
  const reduced: CartRevalidationChange[] = []
  const nextItems: CartItem[] = []

  for (const item of items) {
    const product = await database.products
      .where("[storeId+id]")
      .equals([storeId, item.productId])
      .first()

    if (!product || !product.isActive) {
      removed.push(item.name)
      continue
    }

    const knownStockMilli = product.serverKnownStockMilli ?? (product.serverKnownStock ?? 0) * 1000
    const pendingMilli = product.pendingSoldQuantityMilli ?? (product.pendingSoldQuantity ?? 0) * 1000
    const availableMilli =
      (product.serverKnownStockMilli ?? product.serverKnownStock) == null
        ? Number.POSITIVE_INFINITY
        : Math.max(knownStockMilli - pendingMilli, 0)

    if (availableMilli <= 0) {
      removed.push(item.name)
      continue
    }

    const requestedMilli = item.quantityMilli ?? (item.quantity ?? 0) * 1000
    const saleUnit = item.saleUnit ?? "UNIT"

    if (requestedMilli > availableMilli) {
      reduced.push({ name: item.name, saleUnit, fromMilli: requestedMilli, toMilli: availableMilli })
      nextItems.push({
        ...item,
        quantityMilli: availableMilli,
        quantity: availableMilli / 1000,
        stockMilli: availableMilli,
        stock: availableMilli / 1000,
      })
    } else {
      nextItems.push({
        ...item,
        stockMilli: availableMilli === Number.POSITIVE_INFINITY ? item.stockMilli : availableMilli,
        stock: availableMilli === Number.POSITIVE_INFINITY ? item.stock : availableMilli / 1000,
      })
    }
  }

  return { items: nextItems, removed, reduced }
}
