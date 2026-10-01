import type { CurrentUser, MemberRole } from "../types/api"
import { UserFacingError } from "../utils/errors"
import { db, type PosDatabase } from "./database"
import type { LocalSale } from "./types"

/**
 * Un poste de caisse appartient à un commerce.
 *
 * Il est lié au commerce du premier compte qui s'y connecte en ligne ; un
 * compte d'un autre commerce n'y entre qu'après effacement complet des
 * données locales — et jamais tant qu'une vente du premier attend d'être
 * synchronisée. Ainsi aucune donnée (catalogue, clients, ventes, paniers)
 * d'un commerce n'est jamais visible ni envoyée sous un autre.
 */

export const TERMINAL_ORGANIZATION_KEY = "terminalOrganizationId"
/** Dernier compte authentifié en ligne sur ce poste ; effacé à la déconnexion. */
export const AUTHENTICATED_USER_KEY = "authenticatedUser"

/** Préférences locales conservées quand le poste change de commerce. */
const KEPT_LOCAL_STORAGE_PREFIXES = ["lopos.theme"]

export type AuthenticatedUser = {
  id: number
  username: string
  firstName: string
  organizationId: string
  organizationName: string
  role: MemberRole
  storeIds: string[]
  canViewCosts: boolean
}

export class TerminalOwnedByAnotherCommerceError extends UserFacingError {
  constructor() {
    super(
      "Poste réservé à un autre commerce",
      "Ce poste contient des ventes d’un autre commerce qui ne sont pas encore synchronisées. " +
        "Reconnectez un compte de ce commerce, en ligne, pour les envoyer avant de changer de commerce.",
    )
    this.name = "TerminalOwnedByAnotherCommerceError"
  }
}

function snapshot(user: CurrentUser): AuthenticatedUser {
  return {
    id: user.id,
    username: user.username,
    firstName: user.first_name,
    organizationId: user.organization.id,
    organizationName: user.organization.name,
    role: user.role,
    storeIds: user.store_ids,
    canViewCosts: user.can_view_costs,
  }
}

/**
 * À chaque authentification en ligne : lie le poste au commerce du compte,
 * l'efface d'abord s'il servait un autre commerce, et mémorise le compte.
 *
 * Lève `TerminalOwnedByAnotherCommerceError` (sans rien effacer) si des
 * ventes de l'autre commerce attendent encore d'être envoyées.
 */
export async function bindTerminalToUser(user: CurrentUser, database: PosDatabase = db): Promise<void> {
  const organizationId = user.organization.id
  const now = new Date().toISOString()
  let changedCommerce = false

  await database.transaction("rw", database.tables, async () => {
    const bound = (await database.metadata.get(TERMINAL_ORGANIZATION_KEY))?.value
    changedCommerce = typeof bound === "string" && bound !== organizationId
    if (changedCommerce) {
      const unsynced = await database.localSales
        .where("status")
        .anyOf("PENDING_SYNC", "CONFLICT")
        .count()
      if (unsynced > 0) throw new TerminalOwnedByAnotherCommerceError()
      // Tout, identifiant de terminal compris : le poste repart neuf.
      await Promise.all(database.tables.map((table) => table.clear()))
    }
    await database.metadata.bulkPut([
      { key: TERMINAL_ORGANIZATION_KEY, value: organizationId, updatedAt: now },
      { key: AUTHENTICATED_USER_KEY, value: snapshot(user), updatedAt: now },
    ])
  })
  // Après la transaction : une transaction annulée ne doit rien effacer.
  if (changedCommerce) clearLocalStorage()
}

function clearLocalStorage(): void {
  try {
    const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
    for (const key of keys) {
      if (!key?.startsWith("lopos.")) continue
      if (KEPT_LOCAL_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix))) continue
      localStorage.removeItem(key)
    }
  } catch {
    // localStorage indisponible (navigation privée) : rien à effacer.
  }
}

/**
 * Déconnexion (ou session refusée par le serveur) : le poste ne peut plus
 * reconstruire ce compte hors ligne, et le cahier clients — téléphones,
 * dettes — quitte le poste. Ventes en attente, sessions et paniers restent :
 * un collègue du même commerce les reprendra.
 */
export async function forgetAuthenticatedUser(database: PosDatabase = db): Promise<void> {
  await database.transaction("rw", database.metadata, database.customers, async () => {
    await database.metadata.delete(AUTHENTICATED_USER_KEY)
    await database.customers.clear()
  })
}

export async function getAuthenticatedUser(database: PosDatabase = db): Promise<AuthenticatedUser | null> {
  const value = (await database.metadata.get(AUTHENTICATED_USER_KEY))?.value
  return value && typeof value === "object" ? (value as AuthenticatedUser) : null
}

export async function getTerminalOrganizationId(database: PosDatabase = db): Promise<string | null> {
  const value = (await database.metadata.get(TERMINAL_ORGANIZATION_KEY))?.value
  return typeof value === "string" ? value : null
}

/**
 * Une vente en attente part avec ce compte seulement si elle est de son
 * commerce, et d'un magasin où il travaille — ou sa propre vente : son
 * caissier peut toujours l'envoyer, même retiré du magasin depuis (même
 * règle que le serveur). Une vente antérieure au multi-commerce, sans
 * commerce noté, appartient au commerce du poste.
 */
export function canPushSale(sale: LocalSale, user: AuthenticatedUser): boolean {
  const saleOrganization = sale.organizationId ?? user.organizationId
  if (saleOrganization !== user.organizationId) return false
  return sale.cashierId === user.id || user.storeIds.includes(sale.storeId)
}
