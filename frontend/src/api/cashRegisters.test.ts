// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest"

import { getCashRegister, getCurrentCashSession } from "./cashRegisters"

afterEach(() => {
  vi.restoreAllMocks()
})

describe("cash register API", () => {
  it("gets one register from its encoded detail route", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "register/id" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    )

    await getCashRegister("register/id")

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/v1/cash-registers/register%2Fid/",
    )
  })

  it("maps the backend 404 to an absent current session", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ detail: "No CashSession matches the given query." }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      }),
    )

    await expect(getCurrentCashSession("register-id")).resolves.toBeNull()
  })
})
