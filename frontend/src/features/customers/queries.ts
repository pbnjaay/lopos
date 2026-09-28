import { useEffect } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"

import { getCustomerBook } from "../../api/customers"
import { getCustomerBookMetadata, saveCustomerBook } from "../../db/customers"

export function customerBookLocalQueryKey(storeId: string | null) {
  return ["customer-book-local", storeId] as const
}

/**
 * Garde le cahier du magasin à jour dans IndexedDB, sur le modèle de
 * `useProductCatalog` : snapshot complet au montage, toutes les 5 minutes
 * au plus, et à chaque retour du réseau. C'est ce cache qui permet de
 * choisir un client pour une vente à crédit hors ligne.
 */
export function useCustomerBook(storeId: string | null) {
  const queryClient = useQueryClient()
  const localQuery = useQuery({
    queryKey: customerBookLocalQueryKey(storeId),
    queryFn: () => getCustomerBookMetadata(storeId!),
    enabled: storeId !== null,
  })
  const syncQuery = useQuery({
    queryKey: ["customer-book", storeId],
    queryFn: async () => {
      const customers = await getCustomerBook(storeId!)
      await saveCustomerBook(storeId!, customers)
      await queryClient.invalidateQueries({ queryKey: customerBookLocalQueryKey(storeId) })
      await queryClient.invalidateQueries({ queryKey: ["customers", storeId] })
      return customers.length
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
  return {
    isReady: metadata !== null,
    customerCount: metadata?.customerCount ?? 0,
    lastSyncAt: metadata?.cachedAt ?? null,
    retrySync: () => syncQuery.refetch(),
  }
}
