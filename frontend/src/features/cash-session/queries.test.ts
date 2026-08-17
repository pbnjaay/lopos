// @vitest-environment jsdom

import { describe, expect, it } from "vitest"

import type { CashRegister } from "../../types/api"
import { resolveCashRegister } from "./queries"

function register(id: string, isActive = true): CashRegister {
  return {
    id,
    store_id: "store-id",
    name: `Caisse ${id}`,
    is_active: isActive,
    created_at: "2026-08-17T00:00:00Z",
    updated_at: "2026-08-17T00:00:00Z",
  }
}

describe("resolveCashRegister", () => {
  it("restores the preferred active register", () => {
    expect(resolveCashRegister([register("one"), register("two")], "two")?.id).toBe("two")
  })

  it("automatically selects the only active register", () => {
    expect(resolveCashRegister([register("one"), register("old", false)], null)?.id).toBe("one")
  })

  it("does not guess when several active registers exist", () => {
    expect(resolveCashRegister([register("one"), register("two")], null)).toBeNull()
  })
})
