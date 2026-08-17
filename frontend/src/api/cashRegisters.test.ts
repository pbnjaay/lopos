// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest"

import { getCurrentCashSession } from "./cashRegisters"

afterEach(() => {
  vi.restoreAllMocks()
})

describe("cash register API", () => {
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
