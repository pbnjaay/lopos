import type { Customer, CustomerDetail, CustomerPayment, PaymentMethod } from "../types/api"
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

/** Fiche client avec son historique complet (en ligne uniquement). */
export function getCustomerDetail(customerId: string): Promise<CustomerDetail> {
  return apiRequest<CustomerDetail>(`customers/${encodeURIComponent(customerId)}/`)
}

/**
 * Remboursement client (en ligne uniquement). `idempotencyKey` est généré une
 * fois par tentative : renvoyer la même requête après une coupure ne crée
 * jamais un second paiement.
 */
export function createCustomerPayment(input: {
  idempotencyKey: string
  customerId: string
  cashSessionId: string
  method: PaymentMethod
  amount: string
  receivedAmount: string | null
}): Promise<CustomerPayment> {
  return apiRequest<CustomerPayment>("customer-payments/", {
    method: "POST",
    body: {
      idempotency_key: input.idempotencyKey,
      customer_id: input.customerId,
      cash_session_id: input.cashSessionId,
      method: input.method,
      amount: input.amount,
      received_amount: input.receivedAmount,
    },
  })
}

export function getCustomerPayment(paymentId: string, cashSessionId?: string): Promise<CustomerPayment> {
  return apiRequest<CustomerPayment>(
    buildApiUrl(`customer-payments/${encodeURIComponent(paymentId)}/`, {
      cash_session_id: cashSessionId,
    }),
  )
}
