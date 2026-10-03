import { describe, expect, it } from "vitest"

import type { CashRegister, CashSession, CurrentUser } from "../types/api"
import {
  buildLocalCashSession,
  localSessionToCashRegister,
  localSessionToCashSession,
  localSessionToCurrentUser,
} from "./sessions"

const user: CurrentUser = {
  id: 7,
  username: "caissier",
  first_name: "Awa",
  last_name: "Diop",
  email: "",
  is_staff: false,
}

const register: CashRegister = {
  id: "register-id",
  store_id: "store-id",
  name: "Caisse 01",
  is_active: true,
  created_at: "2026-08-17T00:00:00Z",
  updated_at: "2026-08-17T00:00:00Z",
}

const session: CashSession = {
  id: "session-id",
  cash_register_id: register.id,
  cashier_id: user.id,
  opening_balance: "15000.00",
  status: "OPEN",
  opened_at: "2026-08-17T08:00:00Z",
  closing_balance: null,
  expected_balance: null,
  difference: null,
  closed_at: null,
}

describe("local cash session", () => {
  it("stores the identifiers and non-sensitive cashier identity needed offline", () => {
    const local = buildLocalCashSession(
      session,
      register,
      user,
      "2026-08-17T08:01:00Z",
    )

    expect(local).toMatchObject({
      id: session.id,
      cashRegisterId: register.id,
      cashRegisterName: register.name,
      storeId: register.store_id,
      cashierId: user.id,
      cashierName: "Awa",
      openingBalance: 15_000,
      status: "OPEN",
    })
  })

  it("restores API-compatible route data from the local session", () => {
    const local = buildLocalCashSession(session, register, user)

    expect(localSessionToCashSession(local)).toMatchObject({
      id: session.id,
      cash_register_id: register.id,
      cashier_id: user.id,
      status: "OPEN",
    })
    expect(localSessionToCashRegister(local)).toMatchObject({
      id: register.id,
      store_id: register.store_id,
      name: register.name,
    })
    expect(localSessionToCurrentUser(local)).toMatchObject({
      id: user.id,
      username: "Awa",
    })
  })

  it("rejects fractional opening balances", () => {
    expect(() =>
      buildLocalCashSession(
        { ...session, opening_balance: "15000.50" },
        register,
        user,
      ),
    ).toThrow("Fond de caisse invalide")
  })
})
