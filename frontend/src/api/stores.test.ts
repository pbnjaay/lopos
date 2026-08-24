// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest"

import { getStore, getStores } from "./stores"

afterEach(() => {
  vi.restoreAllMocks()
})

describe("stores API", () => {
  it("lists the stores assigned to the current user", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    )

    await getStores()

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/v1/stores/")
  })

  it("gets the store attached to the selected register", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "store-id",
          name: "Supérette Test",
          address: null,
          is_active: true,
          created_at: "2026-08-17T00:00:00Z",
          updated_at: "2026-08-17T00:00:00Z",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    )

    await getStore("store-id")

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/v1/stores/store-id/")
  })
})
