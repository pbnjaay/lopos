import { useQuery } from "@tanstack/react-query"

import { getProductCatalog } from "../../api/products"
import { saveProductCatalog } from "../../db/products"

export function useProductCatalogCache(storeId: string | null) {
  return useQuery({
    queryKey: ["product-catalog", storeId],
    queryFn: async () => {
      const products = await getProductCatalog(storeId!)
      await saveProductCatalog(storeId!, products)
      return products.length
    },
    enabled: storeId !== null,
    staleTime: 5 * 60_000,
  })
}
