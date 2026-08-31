import type { CashRegister, CashSession, CurrentUser } from "../types/api"
import { db, type PosDatabase } from "./database"
import type { LocalCashSession } from "./types"

function toIntegerAmount(value: string): number {
  const amount = Number(value)
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new Error(`Fond de caisse invalide : ${value}`)
  }
  return amount
}

export function buildLocalCashSession(
  session: CashSession,
  register: CashRegister,
  cashier: Pick<CurrentUser, "id" | "username" | "first_name">,
  cachedAt = new Date().toISOString(),
): LocalCashSession {
  return {
    id: session.id,
    cashRegisterId: register.id,
    cashRegisterName: register.name,
    storeId: register.store_id,
    cashierId: cashier.id,
    cashierName: cashier.first_name || cashier.username,
    openingBalance: toIntegerAmount(session.opening_balance),
    openedAt: session.opened_at,
    status: session.status,
    cachedAt,
  }
}

export async function saveLocalCashSession(
  session: CashSession,
  register: CashRegister,
  cashier: Pick<CurrentUser, "id" | "username" | "first_name">,
  database: PosDatabase = db,
): Promise<LocalCashSession> {
  const existing = await database.cashSessions.get(session.id)
  const localSession = buildLocalCashSession(session, register, cashier)
  // Le nom de la boutique ne vient pas de la session serveur : il est écrit
  // séparément une fois le magasin chargé. Un rafraîchissement de session
  // écrase l'enregistrement entier, il doit donc reporter ce nom — sinon
  // l'en-tête et le repli hors ligne le reperdent à chaque reconnexion.
  if (existing?.storeName) localSession.storeName = existing.storeName
  await database.cashSessions.put(localSession)
  return localSession
}

export async function getLocalCashSessionForRegister(
  cashRegisterId: string,
  database: PosDatabase = db,
): Promise<LocalCashSession | null> {
  const session = await database.cashSessions
    .where("cashRegisterId")
    .equals(cashRegisterId)
    .filter((candidate) => candidate.status === "OPEN")
    .first()

  return session ?? null
}

export async function markLocalCashSessionClosed(
  cashRegisterId: string,
  database: PosDatabase = db,
): Promise<void> {
  const session = await getLocalCashSessionForRegister(cashRegisterId, database)
  if (session) await database.cashSessions.update(session.id, { status: "CLOSED" })
}

export async function updateLocalCashSessionStoreName(
  sessionId: string,
  storeName: string,
  database: PosDatabase = db,
): Promise<void> {
  await database.cashSessions.update(sessionId, { storeName })
}

export function localSessionToCashRegister(session: LocalCashSession): CashRegister {
  return {
    id: session.cashRegisterId,
    store_id: session.storeId,
    name: session.cashRegisterName,
    is_active: true,
    created_at: session.cachedAt,
    updated_at: session.cachedAt,
  }
}

export function localSessionToCashSession(session: LocalCashSession): CashSession {
  return {
    id: session.id,
    cash_register_id: session.cashRegisterId,
    cashier_id: session.cashierId,
    opening_balance: `${session.openingBalance}.00`,
    status: session.status,
    opened_at: session.openedAt,
    closing_balance: null,
    expected_balance: null,
    difference: null,
    closed_at: null,
  }
}

export function localSessionToCurrentUser(session: LocalCashSession): CurrentUser {
  return {
    id: session.cashierId,
    username: session.cashierName,
    first_name: session.cashierName,
    last_name: "",
    email: "",
    is_staff: false,
  }
}
