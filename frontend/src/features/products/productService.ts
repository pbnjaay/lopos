import { getProducts } from "../../api/products"
import { isApiUnavailable } from "../../api/client"
import {
  findLocalProductByBarcode,
  hasLocalProductCatalog,
  searchLocalProducts,
} from "../../db/products"
import type { Product } from "../../types/api"
import type { LocalProduct } from "../../db/types"
import { isNavigatorOnline } from "../../utils/network"
import type { CatalogProduct } from "./types"
import { backendQuantityToMilli } from "../../utils/quantity"

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
  const base: CatalogProduct = {
    id: product.id,
    name: product.name,
    barcode: product.barcode,
    sellingPrice: Math.round(Number(product.selling_price)),
    stock: backendQuantityToMilli(product.stock) / 1000,
    isActive: product.is_active,
  }
  if (product.sale_unit) {
    base.saleUnit = product.sale_unit
    base.stockMilli = backendQuantityToMilli(product.stock)
  }
  return base
}

function fromLocalProduct(product: LocalProduct): CatalogProduct {
  const knownStock = product.serverKnownStockMilli ?? (product.serverKnownStock ?? 0) * 1000
  const pending = product.pendingSoldQuantityMilli ?? (product.pendingSoldQuantity ?? 0) * 1000

  const result: CatalogProduct = {
    id: product.id,
    name: product.name,
    barcode: product.barcode,
    sellingPrice: product.sellingPrice,
    stock: Math.max(knownStock - pending, 0) / 1000,
    isActive: product.isActive,
  }
  if (product.saleUnit) {
    result.saleUnit = product.saleUnit
    result.stockMilli = Math.max(knownStock - pending, 0)
  }
  return result
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
  if (!isNavigatorOnline()) return getLocalProductByBarcode(storeId, barcode)

  try {
    const products = await getProducts({ storeId, barcode })
    return products[0] ? fromApiProduct(products[0]) : null
  } catch (error) {
    if (!isApiUnavailable(error)) throw error
    return getLocalProductByBarcode(storeId, barcode)
  }
}

export async function searchProducts(
  storeId: string,
  search: string,
): Promise<CatalogProduct[]> {
  if (!isNavigatorOnline()) {
    await ensureLocalCatalog(storeId)
    return (await searchLocalProducts(storeId, search)).map(fromLocalProduct)
  }

  try {
    return (await getProducts({ storeId, search })).map(fromApiProduct)
  } catch (error) {
    if (!isApiUnavailable(error)) throw error
    await ensureLocalCatalog(storeId)
    return (await searchLocalProducts(storeId, search)).map(fromLocalProduct)
  }
}
