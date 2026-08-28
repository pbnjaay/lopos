import type { PaymentMethod } from "../types/api"
import { db, type PosDatabase } from "./database"
import type {
  LocalCashSession,
  LocalPayment,
  LocalProduct,
  LocalSale,
  LocalSaleItem,
} from "./types"
import { lineTotal } from "../utils/quantity"

export class LocalSaleProductNotFoundError extends Error {
  constructor(productId: string) {
    super(`Produit introuvable dans le catalogue local : ${productId}`)
    this.name = "LocalSaleProductNotFoundError"
  }
}

export class InsufficientLocalStockError extends Error {
  productName: string
  available: number
  requested: number

  constructor(productName: string, available: number, requested: number) {
    super(
      `Stock local insuffisant pour ${productName} : ${available} disponible(s), ${requested} demandé(s).`,
    )
    this.name = "InsufficientLocalStockError"
    this.productName = productName
    this.available = available
    this.requested = requested
  }
}

export type CreateLocalSaleInput = {
  session: LocalCashSession
  items: Array<{ productId: string; quantityMilli?: number; quantity?: number; unitPrice?: number }>
  payment: {
    method: PaymentMethod
    receivedAmount?: number | null
  }
}

function buildLocalPayment(
  payment: CreateLocalSaleInput["payment"],
  total: number,
): LocalPayment {
  if (payment.method !== "CASH") {
    return { method: payment.method, amount: total, receivedAmount: null, changeAmount: null }
  }

  const receivedAmount = payment.receivedAmount ?? 0
  return {
    method: "CASH",
    amount: total,
    receivedAmount,
    changeAmount: receivedAmount - total,
  }
}

/**
 * Inserts the sale and decrements local stock in a single Dexie transaction,
 * so a local sale can never exist without its stock effect (or vice versa).
 */
export async function createLocalSale(
  input: CreateLocalSaleInput,
  database: PosDatabase = db,
): Promise<LocalSale> {
  const { session, items, payment } = input
  if (items.length === 0) throw new Error("Le panier est vide.")

  return database.transaction("rw", [database.products, database.localSales], async () => {
    const saleItems: LocalSaleItem[] = []
    const productsById = new Map<string, LocalProduct>()

    for (const inputItem of items) {
      const { productId } = inputItem
      const quantityMilli = inputItem.quantityMilli ?? (inputItem.quantity ?? 0) * 1000
      const product = await database.products
        .where("[storeId+id]")
        .equals([session.storeId, productId])
        .first()
      if (!product || !product.isActive) {
        throw new LocalSaleProductNotFoundError(productId)
      }

      const availableStock =
        (product.serverKnownStockMilli ?? product.serverKnownStock) === null
          ? Number.POSITIVE_INFINITY
          : (product.serverKnownStockMilli ?? (product.serverKnownStock ?? 0) * 1000) - (product.pendingSoldQuantityMilli ?? (product.pendingSoldQuantity ?? 0) * 1000)
      if (availableStock < quantityMilli) {
        // Les quantités internes sont en millièmes ; le message est destiné
        // au caissier, donc en unités de vente.
        throw new InsufficientLocalStockError(
          product.name,
          Math.max(availableStock, 0) / 1000,
          quantityMilli / 1000,
        )
      }

      productsById.set(productId, product)
      const saleItem: LocalSaleItem = {
        productId: product.id,
        productName: product.name,
        unitPrice: inputItem.unitPrice ?? product.sellingPrice,
        quantity: quantityMilli / 1000,
        lineTotal: lineTotal(inputItem.unitPrice ?? product.sellingPrice, quantityMilli),
      }
      if (product.saleUnit || inputItem.quantityMilli !== undefined || inputItem.unitPrice !== undefined) {
        saleItem.catalogUnitPrice = product.sellingPrice
        saleItem.saleUnit = product.saleUnit ?? "UNIT"
        saleItem.quantityMilli = quantityMilli
      }
      saleItems.push(saleItem)
    }

    const total = saleItems.reduce((sum, item) => sum + item.lineTotal, 0)

    const sale: LocalSale = {
      id: crypto.randomUUID(),
      serverId: null,
      syncEventId: crypto.randomUUID(),
      cashSessionId: session.id,
      storeId: session.storeId,
      storeName: session.storeName ?? "",
      cashRegisterId: session.cashRegisterId,
      cashRegisterName: session.cashRegisterName,
      cashierId: session.cashierId,
      cashierName: session.cashierName,
      createdAt: new Date().toISOString(),
      status: "PENDING_SYNC",
      conflictCode: null,
      conflictMessage: null,
      items: saleItems,
      payment: buildLocalPayment(payment, total),
      subtotal: total,
      discount: 0,
      total,
    }

    await database.localSales.add(sale)

    for (const item of saleItems) {
      const product = productsById.get(item.productId)!
      await database.products.update([product.storeId, product.id], {
        pendingSoldQuantityMilli: (product.pendingSoldQuantityMilli ?? (product.pendingSoldQuantity ?? 0) * 1000) + (item.quantityMilli ?? (item.quantity ?? 0) * 1000),
        pendingSoldQuantity: ((product.pendingSoldQuantityMilli ?? (product.pendingSoldQuantity ?? 0) * 1000) + (item.quantityMilli ?? (item.quantity ?? 0) * 1000)) / 1000,
      })
    }

    return sale
  })
}

export async function getLocalSaleById(
  id: string,
  database: PosDatabase = db,
): Promise<LocalSale | null> {
  const sale = await database.localSales.get(id)
  return sale ?? null
}

export async function listPendingLocalSales(
  database: PosDatabase = db,
): Promise<LocalSale[]> {
  return database.localSales
    .where("status")
    .equals("PENDING_SYNC")
    .sortBy("createdAt")
}

export async function countPendingLocalSales(database: PosDatabase = db): Promise<number> {
  return database.localSales.where("status").equals("PENDING_SYNC").count()
}

export async function countPendingLocalSalesForSession(
  cashSessionId: string,
  database: PosDatabase = db,
): Promise<number> {
  return database.localSales
    .where("cashSessionId")
    .equals(cashSessionId)
    .filter((sale) => sale.status === "PENDING_SYNC")
    .count()
}

export async function listConflictLocalSales(database: PosDatabase = db): Promise<LocalSale[]> {
  return database.localSales
    .where("status")
    .equals("CONFLICT")
    .sortBy("createdAt")
}

export async function countConflictLocalSales(database: PosDatabase = db): Promise<number> {
  return database.localSales.where("status").equals("CONFLICT").count()
}

/** A sync success is terminal: SYNCED (or an already-processed retry) never reverts. */
export async function markLocalSaleSynced(
  id: string,
  serverId: string,
  database: PosDatabase = db,
): Promise<void> {
  await database.transaction("rw", [database.products, database.localSales], async () => {
    const sale = await database.localSales.get(id)
    if (!sale || sale.status === "SYNCED") return

    const soldByProduct = new Map<string, number>()
    for (const item of sale.items) {
      const quantityMilli = item.quantityMilli ?? (item.quantity ?? 0) * 1000
      soldByProduct.set(
        item.productId,
        (soldByProduct.get(item.productId) ?? 0) + quantityMilli,
      )
    }

    for (const [productId, soldQuantityMilli] of soldByProduct) {
      const product = await database.products.get([sale.storeId, productId])
      if (!product) continue
      const pendingQuantityMilli =
        product.pendingSoldQuantityMilli ??
        (product.pendingSoldQuantity ?? 0) * 1000
      const nextPendingQuantityMilli = Math.max(
        pendingQuantityMilli - soldQuantityMilli,
        0,
      )
      await database.products.update([sale.storeId, productId], {
        pendingSoldQuantityMilli: nextPendingQuantityMilli,
        pendingSoldQuantity: nextPendingQuantityMilli / 1000,
      })
    }

    await database.localSales.update(id, {
      status: "SYNCED",
      serverId,
      conflictCode: null,
      conflictMessage: null,
    })
  })
}

/** CONFLICT covers the server's CONFLICT and REJECTED statuses — both non-retryable automatically. */
export async function markLocalSaleConflict(
  id: string,
  reason: { code: string; message: string },
  database: PosDatabase = db,
): Promise<void> {
  await database.localSales.update(id, {
    status: "CONFLICT",
    conflictCode: reason.code,
    conflictMessage: reason.message,
  })
}
