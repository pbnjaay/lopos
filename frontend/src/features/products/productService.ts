import { getProducts, getTopProducts } from "../../api/products"
import { isApiUnavailable } from "../../api/client"
import {
  findLocalProductByBarcode,
  getLocalProductsByIds,
  getTopProductIds,
  hasLocalProductCatalog,
  listLocalProducts,
  saveTopProductIds,
  searchLocalProducts,
} from "../../db/products"
import type { Product } from "../../types/api"
import type { LocalProduct } from "../../db/types"
import type { CatalogProduct } from "./types"
import { backendQuantityToMilli } from "../../utils/quantity"

export class LocalCatalogUnavailableError extends Error {
  constructor() {
    super("Catalogue indisponible hors ligne. Reconnectez-vous pour charger les produits.")
    this.name = "LocalCatalogUnavailableError"
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

/**
 * Recherche et scan sont local-first : dès que le catalogue du magasin a été
 * synchronisé une fois dans IndexedDB, chaque lookup lit Dexie — que le
 * réseau soit présent ou non. L'API n'est plus qu'un secours pour un
 * terminal dont le catalogue n'a jamais été initialisé ; l'état du réseau
 * navigateur n'est jamais consulté ici (c'est un signal d'UX, pas une
 * source de vérité métier).
 */
export async function getProductByBarcode(
  storeId: string,
  barcode: string,
): Promise<CatalogProduct | null> {
  if (await hasLocalProductCatalog(storeId)) {
    const product = await findLocalProductByBarcode(storeId, barcode)
    return product ? fromLocalProduct(product) : null
  }

  try {
    const products = await getProducts({ storeId, barcode })
    return products[0] ? fromApiProduct(products[0]) : null
  } catch (error) {
    if (!isApiUnavailable(error)) throw error
    throw new LocalCatalogUnavailableError()
  }
}

export async function searchProducts(
  storeId: string,
  search: string,
): Promise<CatalogProduct[]> {
  if (await hasLocalProductCatalog(storeId)) {
    return (await searchLocalProducts(storeId, search)).map(fromLocalProduct)
  }

  try {
    return (await getProducts({ storeId, search })).map(fromApiProduct)
  } catch (error) {
    if (!isApiUnavailable(error)) throw error
    throw new LocalCatalogUnavailableError()
  }
}

/**
 * Meilleures ventes du magasin, pour la grille du rail — jamais le catalogue
 * entier : une superette de plusieurs centaines de references rendrait la
 * grille illisible et le cache inutilement lourd.
 *
 * Trois niveaux de repli, du plus frais au plus resistant :
 * le serveur donne le classement a jour et on le memorise ; hors ligne on
 * rejoue le dernier classement connu ; et si ce terminal n'en a jamais recu,
 * on montre le debut du catalogue local plutot qu'une grille vide.
 */
export async function listTopProducts(
  storeId: string,
  limit: number,
): Promise<CatalogProduct[]> {
  const hasLocalCatalog = await hasLocalProductCatalog(storeId)

  try {
    const ranked = await getTopProducts(storeId, limit)
    const rankedIds = ranked.map((product) => product.id)
    await saveTopProductIds(storeId, rankedIds)
    // Le catalogue local connait le stock deja engage par les ventes non
    // synchronisees : quand il existe, il prime sur la reponse reseau.
    if (hasLocalCatalog) {
      const local = await getLocalProductsByIds(storeId, rankedIds)
      if (local.length > 0) return sortByName(local.map(fromLocalProduct))
    }
    return sortByName(ranked.map(fromApiProduct).filter((product) => product.isActive))
  } catch (error) {
    if (!isApiUnavailable(error)) throw error
    if (!hasLocalCatalog) throw new LocalCatalogUnavailableError()
  }

  const cachedIds = await getTopProductIds(storeId)
  const cached = await getLocalProductsByIds(storeId, cachedIds)
  if (cached.length > 0) return sortByName(cached.map(fromLocalProduct))
  return sortByName((await listLocalProducts(storeId, limit)).map(fromLocalProduct))
}

/**
 * Le classement choisit *quels* produits s'affichent ; l'ordre affiche reste
 * alphabetique. Sans photo, c'est la position d'une tuile qui la designe :
 * elle ne doit pas se deplacer parce que le pain s'est mieux vendu qu'hier.
 */
function sortByName(products: CatalogProduct[]): CatalogProduct[] {
  return [...products].sort((a, b) => a.name.localeCompare(b.name, "fr"))
}
