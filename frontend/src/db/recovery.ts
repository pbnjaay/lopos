import { db, type PosDatabase } from "./database"

function itemQuantityMilli(item: { quantityMilli?: number; quantity?: number }): number {
  const raw = item.quantityMilli ?? (item.quantity ?? 0) * 1000
  const quantityMilli = Math.round(raw)
  if (!Number.isSafeInteger(quantityMilli) || quantityMilli <= 0 || Math.abs(raw - quantityMilli) > 0.001) {
    throw new Error("Quantité de vente locale invalide pendant la récupération IndexedDB.")
  }
  return quantityMilli
}

/**
 * Rebuilds the denormalized local stock effect from durable unsynced sales.
 * It is safe to run on every startup and never mutates or deletes a sale.
 */
export async function repairPendingSoldQuantities(
  database: PosDatabase = db,
): Promise<void> {
  await database.transaction("rw", [database.products, database.localSales], async () => {
    const quantities = new Map<string, number>()
    const key = (storeId: string, productId: string) => `${storeId}\u0000${productId}`

    const unsyncedSales = await database.localSales
      .filter((sale) => sale.status !== "SYNCED")
      .toArray()
    for (const sale of unsyncedSales) {
      for (const item of sale.items) {
        const productKey = key(sale.storeId, item.productId)
        quantities.set(
          productKey,
          (quantities.get(productKey) ?? 0) + itemQuantityMilli(item),
        )
      }
    }

    await database.products.toCollection().modify((product) => {
      const quantityMilli = quantities.get(key(product.storeId, product.id)) ?? 0
      product.pendingSoldQuantityMilli = quantityMilli
      product.pendingSoldQuantity = quantityMilli / 1000
    })
  })
}
