import type { Product } from "../types/api"
import { db, type PosDatabase } from "./database"
import type { LocalProduct } from "./types"
import { backendQuantityToMilli } from "../utils/quantity"

export type ProductCatalogMetadata = {
  storeId: string
  cachedAt: string
  productCount: number
}

export function productCatalogMetadataKey(storeId: string): string {
  return `product-catalog:${storeId}`
}

function toIntegerAmount(value: string): number {
  const amount = Number(value)
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new Error(`Montant produit invalide : ${value}`)
  }
  return amount
}

export function buildLocalProducts(
  storeId: string,
  products: Product[],
  existingProducts: LocalProduct[],
  cachedAt: string,
): LocalProduct[] {
  const existingById = new Map(
    existingProducts.map((product) => [product.id, product]),
  )

  return products.map((product) => {
    const existing = existingById.get(product.id)
    const base: LocalProduct = {
      id: product.id,
      storeId,
      name: product.name,
      barcode: product.barcode,
      sellingPrice: toIntegerAmount(product.selling_price),
      isActive: product.is_active,
      updatedAt: product.updated_at,
      cachedAt,
    }
    if (product.sale_unit) {
      base.saleUnit = product.sale_unit
      base.serverKnownStockMilli = backendQuantityToMilli(product.stock)
      base.pendingSoldQuantityMilli = existing?.pendingSoldQuantityMilli ?? (existing?.pendingSoldQuantity ?? 0) * 1000
    } else {
      base.serverKnownStock = backendQuantityToMilli(product.stock) / 1000
      base.pendingSoldQuantity = existing?.pendingSoldQuantity ?? (existing?.pendingSoldQuantityMilli ?? 0) / 1000
    }
    return base
  })
}

export async function saveProductCatalog(
  storeId: string,
  products: Product[],
  database: PosDatabase = db,
): Promise<void> {
  const cachedAt = new Date().toISOString()

  await database.transaction(
    "rw",
    [database.products, database.metadata],
    async () => {
      const existingProducts = await database.products
        .where("storeId")
        .equals(storeId)
        .toArray()
      const localProducts = buildLocalProducts(
        storeId,
        products,
        existingProducts,
        cachedAt,
      )

      await database.products.where("storeId").equals(storeId).delete()
      if (localProducts.length > 0) {
        await database.products.bulkPut(localProducts)
      }
      await database.metadata.put({
        key: productCatalogMetadataKey(storeId),
        value: {
          storeId,
          cachedAt,
          productCount: localProducts.length,
        } satisfies ProductCatalogMetadata,
        updatedAt: cachedAt,
      })
    },
  )
}

export async function getProductCatalogMetadata(
  storeId: string,
  database: PosDatabase = db,
): Promise<ProductCatalogMetadata | null> {
  const metadata = await database.metadata.get(productCatalogMetadataKey(storeId))
  return (metadata?.value as ProductCatalogMetadata | undefined) ?? null
}

export async function hasLocalProductCatalog(
  storeId: string,
  database: PosDatabase = db,
): Promise<boolean> {
  const metadata = await database.metadata.get(productCatalogMetadataKey(storeId))
  return metadata !== undefined
}

export async function findLocalProductByBarcode(
  storeId: string,
  barcode: string,
  database: PosDatabase = db,
): Promise<LocalProduct | null> {
  const product = await database.products
    .where("[storeId+barcode]")
    .equals([storeId, barcode])
    .first()

  return product?.isActive ? product : null
}

export async function searchLocalProducts(
  storeId: string,
  search: string,
  limit = 8,
  database: PosDatabase = db,
): Promise<LocalProduct[]> {
  const normalizedSearch = search.trim().toLocaleLowerCase("fr")
  if (!normalizedSearch) return []

  const products = await database.products
    .where("storeId")
    .equals(storeId)
    .filter((product) => {
      if (!product.isActive) return false
      const nameMatches = product.name
        .toLocaleLowerCase("fr")
        .includes(normalizedSearch)
      const barcodeMatches = product.barcode?.includes(normalizedSearch) ?? false
      return nameMatches || barcodeMatches
    })
    .sortBy("name")

  return products.slice(0, limit)
}
