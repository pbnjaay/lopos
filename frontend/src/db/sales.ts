import type { PaymentMethod } from "../types/api"
import { db, type PosDatabase } from "./database"
import type {
  LocalCashSession,
  LocalPayment,
  LocalProduct,
  LocalSale,
  LocalSaleItem,
} from "./types"

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
  items: Array<{ productId: string; quantity: number }>
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

    for (const { productId, quantity } of items) {
      const product = await database.products
        .where("[storeId+id]")
        .equals([session.storeId, productId])
        .first()
      if (!product || !product.isActive) {
        throw new LocalSaleProductNotFoundError(productId)
      }

      const availableStock =
        product.serverKnownStock === null
          ? Number.POSITIVE_INFINITY
          : product.serverKnownStock - product.pendingSoldQuantity
      if (availableStock < quantity) {
        throw new InsufficientLocalStockError(
          product.name,
          Math.max(availableStock, 0),
          quantity,
        )
      }

      productsById.set(productId, product)
      saleItems.push({
        productId: product.id,
        productName: product.name,
        unitPrice: product.sellingPrice,
        quantity,
        lineTotal: product.sellingPrice * quantity,
      })
    }

    const total = saleItems.reduce((sum, item) => sum + item.lineTotal, 0)

    const sale: LocalSale = {
      id: crypto.randomUUID(),
      serverId: null,
      cashSessionId: session.id,
      storeId: session.storeId,
      storeName: session.storeName ?? "",
      cashRegisterId: session.cashRegisterId,
      cashRegisterName: session.cashRegisterName,
      cashierId: session.cashierId,
      cashierName: session.cashierName,
      createdAt: new Date().toISOString(),
      status: "PENDING_SYNC",
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
        pendingSoldQuantity: product.pendingSoldQuantity + item.quantity,
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
