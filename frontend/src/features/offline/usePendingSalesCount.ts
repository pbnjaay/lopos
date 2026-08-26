import { useQuery } from "@tanstack/react-query"

import { countPendingLocalSales } from "../../db/sales"

export const pendingSalesCountQueryKey = ["pending-local-sales-count"] as const

export function usePendingSalesCount(enabled = true) {
  const query = useQuery({
    queryKey: pendingSalesCountQueryKey,
    queryFn: () => countPendingLocalSales(),
    staleTime: 0,
    enabled,
  })

  return query.data ?? 0
}
