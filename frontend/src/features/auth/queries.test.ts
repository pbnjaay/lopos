// @vitest-environment jsdom

import "fake-indexeddb/auto"

import { afterEach, describe, expect, it, vi } from "vitest"

import { getCurrentUser, login, logout } from "../../api/auth"
import { ApiError, NetworkError } from "../../api/client"
import { db } from "../../db/database"
import { saveLocalCashSession } from "../../db/sessions"
import {
  AUTHENTICATED_USER_KEY,
  TERMINAL_ORGANIZATION_KEY,
  TerminalOwnedByAnotherCommerceError,
  forgetAuthenticatedUser,
} from "../../db/tenancy"
import type { CashRegister, CashSession, CurrentUser } from "../../types/api"
import { storeCashRegisterId } from "../cash-session/storage"
import {
  OfflineCashSessionUnavailableError,
  getCurrentUserWithOfflineFallback,
  signIn,
} from "./queries"

vi.mock("../../api/auth", () => ({
  getCurrentUser: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
}))

const awa: CurrentUser = {
  id: 7,
  username: "awa",
  first_name: "Awa",
  last_name: "Diop",
  email: "",
  is_staff: false,
  organization: { id: "org-a", name: "Boutique A" },
  role: "CASHIER",
  store_ids: ["store-a"],
  can_view_costs: false,
}

const register: CashRegister = {
  id: "register-a",
  store_id: "store-a",
  name: "Caisse 01",
  is_active: true,
  created_at: "2026-08-17T00:00:00Z",
  updated_at: "2026-08-17T00:00:00Z",
}

function openSession(cashierId: number): CashSession {
  return {
    id: `session-${cashierId}`,
    cash_register_id: register.id,
    cashier_id: cashierId,
    opening_balance: "0.00",
    status: "OPEN",
    opened_at: "2026-08-17T08:00:00Z",
    closing_balance: null,
    expected_balance: null,
    difference: null,
    closed_at: null,
  }
}

/** Awa s'est connectée en ligne et a ouvert sa caisse sur ce poste. */
async function awaWorkedOnline(): Promise<void> {
  vi.mocked(getCurrentUser).mockResolvedValueOnce(awa)
  await getCurrentUserWithOfflineFallback()
  await saveLocalCashSession(openSession(awa.id), register, awa)
  storeCashRegisterId(register.id)
}

function goOffline(): void {
  vi.mocked(getCurrentUser).mockRejectedValue(new NetworkError())
}

afterEach(async () => {
  vi.resetAllMocks()
  localStorage.clear()
  await Promise.all(db.tables.map((table) => table.clear()))
})

describe("online authentication", () => {
  it("binds the terminal to the account's commerce and remembers the account", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(awa)

    await expect(getCurrentUserWithOfflineFallback()).resolves.toEqual(awa)

    expect((await db.metadata.get(TERMINAL_ORGANIZATION_KEY))?.value).toBe("org-a")
    expect((await db.metadata.get(AUTHENTICATED_USER_KEY))?.value).toMatchObject({
      id: 7,
      organizationId: "org-a",
      storeIds: ["store-a"],
    })
  })

  it("does not fall back offline on an error the server answered", async () => {
    const answered = new ApiError(400, { detail: "Non." })
    vi.mocked(getCurrentUser).mockRejectedValue(answered)

    await expect(getCurrentUserWithOfflineFallback()).rejects.toBe(answered)
  })
})

describe("offline continuity", () => {
  it("lets the last online account resume its own open session", async () => {
    await awaWorkedOnline()
    goOffline()

    await expect(getCurrentUserWithOfflineFallback()).resolves.toMatchObject({
      id: awa.id,
      organization: { id: "org-a" },
      role: "CASHIER",
      store_ids: ["store-a"],
    })
  })

  it("locks the terminal after a logout, even with a session still open", async () => {
    await awaWorkedOnline()
    await forgetAuthenticatedUser()
    goOffline()

    await expect(getCurrentUserWithOfflineFallback()).rejects.toBeInstanceOf(
      OfflineCashSessionUnavailableError,
    )
  })

  it("locks the terminal once the server stops recognising the session", async () => {
    await awaWorkedOnline()
    vi.mocked(getCurrentUser).mockResolvedValueOnce(null)
    await expect(getCurrentUserWithOfflineFallback()).resolves.toBeNull()
    goOffline()

    await expect(getCurrentUserWithOfflineFallback()).rejects.toBeInstanceOf(
      OfflineCashSessionUnavailableError,
    )
  })

  it("never resumes a colleague's session", async () => {
    await awaWorkedOnline()
    await db.cashSessions.clear()
    await saveLocalCashSession(openSession(99), register, { ...awa, id: 99 })
    goOffline()

    await expect(getCurrentUserWithOfflineFallback()).rejects.toBeInstanceOf(
      OfflineCashSessionUnavailableError,
    )
  })

  it("never resumes a session in a store the account no longer works in", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ ...awa, store_ids: [] })
    await getCurrentUserWithOfflineFallback()
    await saveLocalCashSession(openSession(awa.id), register, awa)
    storeCashRegisterId(register.id)
    goOffline()

    await expect(getCurrentUserWithOfflineFallback()).rejects.toBeInstanceOf(
      OfflineCashSessionUnavailableError,
    )
  })

  it("requires a previous online login when nothing is known", async () => {
    goOffline()

    await expect(getCurrentUserWithOfflineFallback()).rejects.toBeInstanceOf(
      OfflineCashSessionUnavailableError,
    )
  })
})

describe("terminal of another commerce", () => {
  const moussa: CurrentUser = {
    ...awa,
    id: 8,
    username: "moussa",
    organization: { id: "org-b", name: "Boutique B" },
    store_ids: ["store-b"],
  }

  it("refuses an account of another commerce while sales wait to be sent", async () => {
    await awaWorkedOnline()
    await db.localSales.put({
      id: "sale-a",
      organizationId: "org-a",
      status: "PENDING_SYNC",
      storeId: "store-a",
      cashierId: awa.id,
      createdAt: "2026-08-17T09:00:00Z",
    } as never)
    vi.mocked(login).mockResolvedValue(moussa)
    vi.mocked(logout).mockResolvedValue({ detail: "Logged out" })

    await expect(signIn({ username: "moussa", password: "x" })).rejects.toBeInstanceOf(
      TerminalOwnedByAnotherCommerceError,
    )

    // La session serveur tout juste ouverte est refermée ; rien n'est effacé.
    expect(logout).toHaveBeenCalled()
    expect(await db.localSales.count()).toBe(1)
    expect((await db.metadata.get(TERMINAL_ORGANIZATION_KEY))?.value).toBe("org-a")
  })

  it("wipes everything local before admitting another commerce on a synced terminal", async () => {
    await awaWorkedOnline()
    await db.products.put({ id: "product-a", storeId: "store-a", name: "Riz A" } as never)
    await db.customers.put({ id: "customer-a", storeId: "store-a", name: "Client A" } as never)
    await db.carts.put({ id: "cart-a", cashSessionId: "session-7", status: "HELD" } as never)
    await db.localSales.put({ id: "sale-a", status: "SYNCED", createdAt: "x" } as never)
    await db.metadata.put({ key: "terminalId", value: "terminal-a", updatedAt: "x" })
    localStorage.setItem("lopos.lastPaymentMethod", "CASH")
    localStorage.setItem("autre.app", "garde")
    vi.mocked(login).mockResolvedValue(moussa)

    await expect(signIn({ username: "moussa", password: "x" })).resolves.toEqual(moussa)

    for (const table of [db.products, db.customers, db.carts, db.localSales, db.cashSessions]) {
      expect(await table.count()).toBe(0)
    }
    expect(await db.metadata.get("terminalId")).toBeUndefined()
    expect((await db.metadata.get(TERMINAL_ORGANIZATION_KEY))?.value).toBe("org-b")
    expect(localStorage.getItem("lopos.selectedCashRegisterId")).toBeNull()
    expect(localStorage.getItem("lopos.lastPaymentMethod")).toBeNull()
    expect(localStorage.getItem("autre.app")).toBe("garde")
  })

  it("keeps everything when the same commerce logs back in", async () => {
    await awaWorkedOnline()
    await db.products.put({ id: "product-a", storeId: "store-a", name: "Riz A" } as never)
    vi.mocked(login).mockResolvedValue({ ...awa, id: 9, username: "fatou" })

    await signIn({ username: "fatou", password: "x" })

    expect(await db.products.count()).toBe(1)
    expect(await db.cashSessions.count()).toBe(1)
  })
})

describe("logout", () => {
  it("removes the customer book from the terminal but keeps pending work", async () => {
    await awaWorkedOnline()
    await db.customers.put({ id: "customer-a", storeId: "store-a", name: "Client A" } as never)
    await db.localSales.put({ id: "sale-a", status: "PENDING_SYNC", createdAt: "x" } as never)

    await forgetAuthenticatedUser()

    expect(await db.customers.count()).toBe(0)
    expect(await db.localSales.count()).toBe(1)
    expect(await db.metadata.get(AUTHENTICATED_USER_KEY)).toBeUndefined()
  })
})
