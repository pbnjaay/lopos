import type { Customer } from "../types/api"
import { phoneSearchDigits } from "../utils/phone"
import { db, type PosDatabase } from "./database"
import type { LocalCustomer } from "./types"

export type CustomerBookMetadata = {
  storeId: string
  cachedAt: string
  customerCount: number
}

export function customerBookMetadataKey(storeId: string): string {
  return `customer-book:${storeId}`
}

function toIntegerBalance(value: string): number {
  const amount = Math.round(Number(value))
  if (!Number.isSafeInteger(amount)) {
    throw new Error(`Solde client invalide : ${value}`)
  }
  return amount
}

export function buildLocalCustomer(customer: Customer, cachedAt: string): LocalCustomer {
  return {
    id: customer.id,
    storeId: customer.store_id,
    name: customer.name,
    phone: customer.phone,
    isActive: customer.is_active,
    serverBalance: toIntegerBalance(customer.balance),
    lastActivityAt: customer.last_activity_at,
    updatedAt: customer.updated_at,
    cachedAt,
  }
}

/**
 * Remplace le cahier local du magasin par le snapshot serveur, dans une seule
 * transaction : la recherche ne voit jamais un cahier à moitié écrit.
 */
export async function saveCustomerBook(
  storeId: string,
  customers: Customer[],
  database: PosDatabase = db,
): Promise<void> {
  const cachedAt = new Date().toISOString()
  const localCustomers = customers.map((customer) => buildLocalCustomer(customer, cachedAt))

  await database.transaction("rw", [database.customers, database.metadata], async () => {
    await database.customers.where("storeId").equals(storeId).delete()
    if (localCustomers.length > 0) await database.customers.bulkPut(localCustomers)
    await database.metadata.put({
      key: customerBookMetadataKey(storeId),
      value: {
        storeId,
        cachedAt,
        customerCount: localCustomers.length,
      } satisfies CustomerBookMetadata,
      updatedAt: cachedAt,
    })
  })
}

export async function getCustomerBookMetadata(
  storeId: string,
  database: PosDatabase = db,
): Promise<CustomerBookMetadata | null> {
  const metadata = await database.metadata.get(customerBookMetadataKey(storeId))
  const bookMetadata = metadata?.value as CustomerBookMetadata | undefined
  if (!bookMetadata) return null

  const actualCount = await database.customers.where("storeId").equals(storeId).count()
  return actualCount === bookMetadata.customerCount ? bookMetadata : null
}

export async function hasLocalCustomerBook(
  storeId: string,
  database: PosDatabase = db,
): Promise<boolean> {
  return (await getCustomerBookMetadata(storeId, database)) !== null
}

/**
 * Ajoute ou met à jour un client juste créé (ou retrouvé en doublon) sans
 * attendre le prochain snapshot, pour qu'il soit sélectionnable tout de
 * suite — y compris si le réseau tombe juste après.
 */
export async function upsertLocalCustomer(
  customer: Customer,
  database: PosDatabase = db,
): Promise<LocalCustomer> {
  const cachedAt = new Date().toISOString()
  const local = buildLocalCustomer(customer, cachedAt)

  await database.transaction("rw", [database.customers, database.metadata], async () => {
    const isNew = (await database.customers.get([local.storeId, local.id])) === undefined
    await database.customers.put(local)
    const metadata = await database.metadata.get(customerBookMetadataKey(local.storeId))
    const bookMetadata = metadata?.value as CustomerBookMetadata | undefined
    // Sans snapshot initial, on n'invente pas de métadonnées : le cahier
    // n'est « prêt » qu'après un téléchargement complet.
    if (bookMetadata && isNew) {
      await database.metadata.put({
        key: customerBookMetadataKey(local.storeId),
        value: { ...bookMetadata, customerCount: bookMetadata.customerCount + 1 },
        updatedAt: cachedAt,
      })
    }
  })
  return local
}

/** Minuscules, sans accents : « Aïssatou » se trouve en tapant « aissatou ». */
export function normalizeSearchText(value: string): string {
  return value.normalize("NFD").replaceAll(/\p{Diacritic}/gu, "").toLocaleLowerCase("fr").trim()
}

/**
 * Recherche locale d'un client actif : par numéro si la saisie n'est que des
 * chiffres (n'importe quelle partie du numéro, « 4567 » suffit), sinon par
 * nom — chaque mot saisi doit apparaître, dans n'importe quel ordre.
 */
export async function searchLocalCustomers(
  storeId: string,
  query: string,
  limit = 8,
  database: PosDatabase = db,
): Promise<LocalCustomer[]> {
  const digits = phoneSearchDigits(query)
  const words = normalizeSearchText(query).split(/\s+/).filter(Boolean)
  if (digits === null && words.length === 0) return []

  const customers = await database.customers
    .where("storeId")
    .equals(storeId)
    .filter((customer) => {
      if (!customer.isActive) return false
      if (digits !== null) return customer.phone?.replaceAll(/\D/g, "").includes(digits) ?? false
      const name = normalizeSearchText(customer.name)
      return words.every((word) => name.includes(word))
    })
    .sortBy("name")

  return customers.slice(0, limit)
}

/** Tout le cahier du magasin, pour l'écran de liste (filtré et trié par l'appelant). */
export async function listLocalCustomers(
  storeId: string,
  database: PosDatabase = db,
): Promise<LocalCustomer[]> {
  return database.customers.where("storeId").equals(storeId).sortBy("name")
}

export async function getLocalCustomer(
  storeId: string,
  customerId: string,
  database: PosDatabase = db,
): Promise<LocalCustomer | null> {
  return (await database.customers.get([storeId, customerId])) ?? null
}

/**
 * Reporte un remboursement confirmé par le serveur dans le cache : le solde
 * connu devient celui qu'il a calculé, sans attendre le prochain snapshot.
 */
export async function applyLocalCustomerPayment(
  storeId: string,
  customerId: string,
  payment: { balanceAfter: number; paidAt: string },
  database: PosDatabase = db,
): Promise<void> {
  await database.customers.update([storeId, customerId], {
    serverBalance: payment.balanceAfter,
    lastActivityAt: payment.paidAt,
  })
}
