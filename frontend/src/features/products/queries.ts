import { useEffect } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"

import { getProductCatalog } from "../../api/products"
import { getProductCatalogMetadata, saveProductCatalog } from "../../db/products"

export type ProductCatalogStatus =
  | "catalogue_not_initialized"
  | "catalogue_syncing"
  | "catalogue_ready"
  | "catalogue_error"

export function productCatalogLocalQueryKey(storeId: string | null) {
  return ["product-catalog-local", storeId] as const
}

/**
 * Synchronise le catalogue complet du magasin vers IndexedDB et expose un
 * état explicite : un terminal qui n'a jamais téléchargé son catalogue ne
 * doit pas prétendre être prêt hors ligne. Une fois `catalogue_ready`, le
 * catalogue reste persistant (Dexie) et la recherche est locale ; la
 * resynchronisation périodique ne fait que rafraîchir prix/stock.
 */
export function useProductCatalog(storeId: string | null) {
  const queryClient = useQueryClient()
  const localQuery = useQuery({
    queryKey: productCatalogLocalQueryKey(storeId),
    queryFn: () => getProductCatalogMetadata(storeId!),
    enabled: storeId !== null,
  })
  const syncQuery = useQuery({
    queryKey: ["product-catalog", storeId],
    queryFn: async () => {
      const products = await getProductCatalog(storeId!)
      await saveProductCatalog(storeId!, products)
      // La recherche lit Dexie : rafraîchir les résultats affichés et les
      // métadonnées locales dès que le snapshot vient d'être remplacé.
      await queryClient.invalidateQueries({ queryKey: productCatalogLocalQueryKey(storeId) })
      await queryClient.invalidateQueries({ queryKey: ["products", storeId] })
      return products.length
    },
    enabled: storeId !== null,
    staleTime: 5 * 60_000,
  })

  useEffect(() => {
    if (storeId === null) return

    function refreshAfterReconnect() {
      void syncQuery.refetch()
    }

    window.addEventListener("online", refreshAfterReconnect)
    return () => window.removeEventListener("online", refreshAfterReconnect)
  }, [storeId, syncQuery.refetch])

  const metadata = localQuery.data ?? null
  const status: ProductCatalogStatus =
    storeId === null
      ? "catalogue_not_initialized"
      : metadata !== null
        ? "catalogue_ready"
        : localQuery.isPending || syncQuery.isFetching
          ? "catalogue_syncing"
          : syncQuery.isError
            ? "catalogue_error"
            : "catalogue_not_initialized"

  return {
    status,
    productCount: metadata?.productCount ?? 0,
    lastSyncAt: metadata?.cachedAt ?? null,
    syncError: metadata === null ? syncQuery.error : null,
    retrySync: () => syncQuery.refetch(),
  }
}
