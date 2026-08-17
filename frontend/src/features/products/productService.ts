import { getProducts } from "../../api/products"
import { ApiError, NetworkError } from "../../api/client"
import {
  findLocalProductByBarcode,
  hasLocalProductCatalog,
  searchLocalProducts,
} from "../../db/products"
import type { Product } from "../../types/api"
import type { LocalProduct } from "../../db/types"
import type { CatalogProduct } from "./types"

export class LocalCatalogUnavailableError extends Error {
  constructor() {
    super("Catalogue indisponible hors ligne. Reconnectez-vous pour charger les produits.")
    this.name = "LocalCatalogUnavailableError"
  }
}

export class LocalProductNotFoundError extends Error {
  constructor() {
    super("Produit introuvable dans le catalogue local.")
    this.name = "LocalProductNotFoundError"
  }
}

function fromApiProduct(product: Product): CatalogProduct {
  return {
    id: product.id,
    name: product.name,
    barcode: product.barcode,
    sellingPrice: Math.round(Number(product.selling_price)),
    stock: product.stock,
    isActive: product.is_active,
  }
}

function fromLocalProduct(product: LocalProduct): CatalogProduct {
  const knownStock = product.serverKnownStock ?? 0

  return {
    id: product.id,
    name: product.name,
    barcode: product.barcode,
    sellingPrice: product.sellingPrice,
    stock: Math.max(knownStock - product.pendingSoldQuantity, 0),
    isActive: product.isActive,
  }
}

function browserIsOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine
}

function canUseLocalFallback(error: unknown): boolean {
  return error instanceof NetworkError || (error instanceof ApiError && error.status >= 500)
}

async function ensureLocalCatalog(storeId: string): Promise<void> {
  if (!(await hasLocalProductCatalog(storeId))) {
    throw new LocalCatalogUnavailableError()
  }
}

async function getLocalProductByBarcode(
  storeId: string,
  barcode: string,
): Promise<CatalogProduct> {
  await ensureLocalCatalog(storeId)
  const product = await findLocalProductByBarcode(storeId, barcode)
  if (!product) throw new LocalProductNotFoundError()
  return fromLocalProduct(product)
}

export async function getProductByBarcode(
  storeId: string,
  barcode: string,
): Promise<CatalogProduct | null> {
  if (!browserIsOnline()) return getLocalProductByBarcode(storeId, barcode)

  try {
    const products = await getProducts({ storeId, barcode })
    return products[0] ? fromApiProduct(products[0]) : null
  } catch (error) {
    if (!canUseLocalFallback(error)) throw error
    return getLocalProductByBarcode(storeId, barcode)
  }
}

export async function searchProducts(
  storeId: string,
  search: string,
): Promise<CatalogProduct[]> {
  if (!browserIsOnline()) {
    await ensureLocalCatalog(storeId)
    return (await searchLocalProducts(storeId, search)).map(fromLocalProduct)
  }

  try {
    return (await getProducts({ storeId, search })).map(fromApiProduct)
  } catch (error) {
    if (!canUseLocalFallback(error)) throw error
    await ensureLocalCatalog(storeId)
    return (await searchLocalProducts(storeId, search)).map(fromLocalProduct)
  }
}
