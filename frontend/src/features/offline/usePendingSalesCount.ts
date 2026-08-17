import { useQuery } from "@tanstack/react-query"

import { countPendingLocalSales } from "../../db/sales"

export const pendingSalesCountQueryKey = ["pending-local-sales-count"] as const

export function usePendingSalesCount() {
  const query = useQuery({
    queryKey: pendingSalesCountQueryKey,
    queryFn: () => countPendingLocalSales(),
    staleTime: 0,
  })

  return query.data ?? 0
}
