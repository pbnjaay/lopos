import type { Product } from "../types/api"
import { apiRequest, buildApiUrl } from "./client"

type ProductLookup =
  | { storeId: string; search: string; barcode?: never }
  | { storeId: string; barcode: string; search?: never }

export function getProducts(lookup: ProductLookup): Promise<Product[]> {
  return apiRequest<Product[]>(
    buildApiUrl("products/", {
      store_id: lookup.storeId,
      search: lookup.search,
      barcode: lookup.barcode,
    }),
  )
}

export function getProductCatalog(storeId: string): Promise<Product[]> {
  return apiRequest<Product[]>(
    buildApiUrl("products/", {
      store_id: storeId,
    }),
  )
}
