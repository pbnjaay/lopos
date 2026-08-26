import { QueryClient } from "@tanstack/react-query"

/**
 * `networkMode: "always"` partout : dans ce POS, chaque queryFn/mutationFn
 * est soit une lecture Dexie pure (elle doit tourner surtout hors ligne),
 * soit un appel API doté de son propre fallback local explicite
 * (`isApiUnavailable` → IndexedDB). Le mode par défaut de TanStack Query
 * ("online") met ces fonctions en pause dès que l'événement `offline` du
 * navigateur a été reçu — précisément le moment où le fallback local doit
 * s'exécuter. C'était la cause des encaissements suspendus et des
 * recherches muettes après une coupure réseau, "réparés" par un refresh
 * uniquement parce que l'onlineManager redémarre à `online: true`.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: 1,
        refetchOnWindowFocus: false,
        networkMode: "always",
      },
      mutations: {
        retry: false,
        networkMode: "always",
      },
    },
  })
}
