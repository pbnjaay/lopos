import type { Customer } from "../types/api"
import { apiRequest, buildApiUrl } from "./client"

/** Cahier complet du magasin — snapshot pour le cache local, comme le catalogue. */
export function getCustomerBook(storeId: string): Promise<Customer[]> {
  return apiRequest<Customer[]>(buildApiUrl("customers/", { store_id: storeId }))
}

/**
 * Création rapide depuis la caisse (en ligne uniquement). Un numéro déjà
 * connu dans le magasin répond 409 `CUSTOMER_DUPLICATE` avec le client
 * existant dans `body.customer`.
 */
export function createCustomer(input: {
  storeId: string
  name: string
  phone: string
}): Promise<Customer> {
  return apiRequest<Customer>("customers/", {
    method: "POST",
    body: { store_id: input.storeId, name: input.name, phone: input.phone },
  })
}
