import { ApiError, isApiUnavailable } from "../../api/client"
import { createCustomer, getCustomerBook } from "../../api/customers"
import {
  hasLocalCustomerBook,
  saveCustomerBook,
  searchLocalCustomers,
  upsertLocalCustomer,
} from "../../db/customers"
import type { LocalCustomer } from "../../db/types"
import type { Customer } from "../../types/api"

/** Client tel que l'écran le manipule : solde en FCFA entiers. */
export type CustomerSummary = {
  id: string
  name: string
  phone: string | null
  /** Solde dû connu (dernier snapshot serveur). */
  balance: number
  isActive: boolean
}

export class LocalCustomerBookUnavailableError extends Error {
  constructor() {
    super("Cahier clients indisponible hors ligne. Reconnectez-vous pour le charger.")
    this.name = "LocalCustomerBookUnavailableError"
  }
}

/** Le numéro saisi appartient déjà à un client du magasin. */
export class DuplicateCustomerError extends Error {
  readonly existing: CustomerSummary

  constructor(existing: CustomerSummary) {
    super(`Ce numéro appartient déjà à ${existing.name}.`)
    this.name = "DuplicateCustomerError"
    this.existing = existing
  }
}

export function fromLocalCustomer(customer: LocalCustomer): CustomerSummary {
  return {
    id: customer.id,
    name: customer.name,
    phone: customer.phone,
    balance: customer.serverBalance,
    isActive: customer.isActive,
  }
}

/**
 * Recherche local-first, comme le catalogue : dès que le cahier du magasin
 * est en cache, Dexie répond, réseau ou pas. Un terminal qui ne l'a jamais
 * téléchargé le récupère d'abord (et le garde pour la suite).
 */
export async function searchCustomers(storeId: string, query: string): Promise<CustomerSummary[]> {
  if (!(await hasLocalCustomerBook(storeId))) {
    try {
      await saveCustomerBook(storeId, await getCustomerBook(storeId))
    } catch (error) {
      if (!isApiUnavailable(error)) throw error
      throw new LocalCustomerBookUnavailableError()
    }
  }
  return (await searchLocalCustomers(storeId, query)).map(fromLocalCustomer)
}

/**
 * Création rapide (en ligne uniquement). Le client créé — ou le client
 * existant en cas de numéro déjà connu — est aussitôt ajouté au cache local.
 */
export async function quickCreateCustomer(input: {
  storeId: string
  name: string
  phone: string
}): Promise<CustomerSummary> {
  try {
    return fromLocalCustomer(await upsertLocalCustomer(await createCustomer(input)))
  } catch (error) {
    if (error instanceof ApiError && error.code === "CUSTOMER_DUPLICATE" && error.body?.customer) {
      const existing = await upsertLocalCustomer(error.body.customer as Customer)
      throw new DuplicateCustomerError(fromLocalCustomer(existing))
    }
    throw error
  }
}
