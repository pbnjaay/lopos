// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest"

import { ApiError, NetworkError, apiRequest, buildApiUrl } from "./client"

afterEach(() => {
  vi.restoreAllMocks()
  document.cookie = "csrftoken=; Max-Age=0; path=/"
})

describe("buildApiUrl", () => {
  it("builds a URL with encoded query parameters", () => {
    expect(buildApiUrl("products/", { search: "café au lait", stock: 0 })).toBe(
      "/api/v1/products/?search=caf%C3%A9+au+lait&stock=0",
    )
  })
})

describe("apiRequest", () => {
  it("sends cookies, JSON and the Django CSRF token on writes", async () => {
    document.cookie = "csrftoken=test-token; path=/"
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "session-id" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    )

    await apiRequest<{ id: string }>("cash-sessions/open/", {
      method: "POST",
      body: { opening_balance: "15000.00" },
    })

    const [, request] = fetchMock.mock.calls[0] ?? []
    const headers = new Headers(request?.headers)
    expect(request?.credentials).toBe("include")
    expect(headers.get("Content-Type")).toBe("application/json")
    expect(headers.get("X-CSRFToken")).toBe("test-token")
  })

  it("preserves business errors returned by Django", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          code: "INSUFFICIENT_STOCK",
          message: "Stock insuffisant pour Coca 50cl.",
        }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      ),
    )

    await expect(apiRequest("sales/", { method: "POST", body: {} })).rejects.toMatchObject({
      status: 409,
      code: "INSUFFICIENT_STOCK",
      message: "Stock insuffisant pour Coca 50cl.",
    } satisfies Partial<ApiError>)
  })

  it("turns fetch failures into a user-facing network error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"))

    await expect(apiRequest("products/")).rejects.toBeInstanceOf(NetworkError)
  })
})
