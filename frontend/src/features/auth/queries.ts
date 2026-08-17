import { useQuery } from "@tanstack/react-query"

import { getCurrentUser } from "../../api/auth"

export const currentUserQueryKey = ["auth", "me"] as const

export function useCurrentUser() {
  return useQuery({
    queryKey: currentUserQueryKey,
    queryFn: getCurrentUser,
    retry: false,
    staleTime: 30_000,
  })
}
