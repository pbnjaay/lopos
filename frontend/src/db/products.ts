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
  pendingSoldQuantityByProductId?: ReadonlyMap<string, number>,
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
      base.pendingSoldQuantityMilli =
        pendingSoldQuantityByProductId?.get(product.id) ??
        existing?.pendingSoldQuantityMilli ??
        (existing?.pendingSoldQuantity ?? 0) * 1000
    } else {
      base.serverKnownStock = backendQuantityToMilli(product.stock) / 1000
      base.pendingSoldQuantity =
        (pendingSoldQuantityByProductId?.get(product.id) ??
          existing?.pendingSoldQuantityMilli ??
          (existing?.pendingSoldQuantity ?? 0) * 1000) / 1000
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
    [database.products, database.localSales, database.metadata],
    async () => {
      const existingProducts = await database.products
        .where("storeId")
        .equals(storeId)
        .toArray()
      const pendingSoldQuantityByProductId = new Map<string, number>()
      const unsyncedSales = await database.localSales
        .filter((sale) => sale.storeId === storeId && sale.status !== "SYNCED")
        .toArray()
      for (const sale of unsyncedSales) {
        for (const item of sale.items) {
          const quantityMilli = item.quantityMilli ?? (item.quantity ?? 0) * 1000
          pendingSoldQuantityByProductId.set(
            item.productId,
            (pendingSoldQuantityByProductId.get(item.productId) ?? 0) + quantityMilli,
          )
        }
      }

      const localProducts = buildLocalProducts(
        storeId,
        products,
        existingProducts,
        cachedAt,
        pendingSoldQuantityByProductId,
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
  const catalogMetadata = metadata?.value as ProductCatalogMetadata | undefined
  if (!catalogMetadata) return null

  const actualProductCount = await database.products
    .where("storeId")
    .equals(storeId)
    .count()
  return actualProductCount === catalogMetadata.productCount
    ? catalogMetadata
    : null
}

export async function hasLocalProductCatalog(
  storeId: string,
  database: PosDatabase = db,
): Promise<boolean> {
  return (await getProductCatalogMetadata(storeId, database)) !== null
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

/**
 * Debut du catalogue, par ordre alphabetique. Sert de filet a la grille du
 * POS quand aucune meilleure vente n'est connue (magasin neuf, ou terminal
 * hors ligne qui n'a jamais recu de classement).
 */
export async function listLocalProducts(
  storeId: string,
  limit: number,
  database: PosDatabase = db,
): Promise<LocalProduct[]> {
  const products = await database.products
    .where("storeId")
    .equals(storeId)
    .filter((product) => product.isActive)
    .sortBy("name")
  return products.slice(0, limit)
}

export function topProductsKey(storeId: string): string {
  return `top-products:${storeId}`
}

/**
 * Classement des meilleures ventes, garde en local pour que la grille reste
 * pertinente hors ligne. On ne stocke que des identifiants : prix et stock
 * sont relus depuis le catalogue, qui a sa propre synchronisation.
 */
export async function saveTopProductIds(
  storeId: string,
  productIds: string[],
  database: PosDatabase = db,
): Promise<void> {
  await database.metadata.put({
    key: topProductsKey(storeId),
    value: productIds,
    updatedAt: new Date().toISOString(),
  })
}

export async function getTopProductIds(
  storeId: string,
  database: PosDatabase = db,
): Promise<string[]> {
  const record = await database.metadata.get(topProductsKey(storeId))
  return Array.isArray(record?.value) ? (record.value as string[]) : []
}

/** Produits correspondant a une liste d'identifiants, actifs uniquement. */
export async function getLocalProductsByIds(
  storeId: string,
  productIds: string[],
  database: PosDatabase = db,
): Promise<LocalProduct[]> {
  if (productIds.length === 0) return []
  const found = await database.products
    .where("[storeId+id]")
    .anyOf(productIds.map((id) => [storeId, id] as [string, string]))
    .toArray()
  return found.filter((product) => product.isActive)
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
