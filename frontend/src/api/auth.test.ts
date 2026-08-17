// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest"

import { getCurrentUser, login } from "./auth"

afterEach(() => {
  vi.restoreAllMocks()
  document.cookie = "csrftoken=; Max-Age=0; path=/"
})

describe("auth API", () => {
  it("gets a CSRF cookie before posting credentials", async () => {
    const user = {
      id: 7,
      username: "cashier",
      email: "",
      first_name: "Awa",
      last_name: "Diop",
      is_staff: false,
    }
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(async () => {
        document.cookie = "csrftoken=csrf-from-django; path=/"
        return new Response(JSON.stringify({ detail: "CSRF cookie set" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      })
      .mockResolvedValueOnce(
        new Response(JSON.stringify(user), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )

    await expect(login({ username: "cashier", password: "secret" })).resolves.toEqual(user)

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/v1/auth/csrf/")
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/v1/auth/login/")
    const loginRequest = fetchMock.mock.calls[1]?.[1]
    expect(new Headers(loginRequest?.headers).get("X-CSRFToken")).toBe("csrf-from-django")
    expect(loginRequest?.body).toBe(
      JSON.stringify({ username: "cashier", password: "secret" }),
    )
  })

  it("maps an anonymous me response to null", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ detail: "Authentication credentials were not provided." }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }),
    )

    await expect(getCurrentUser()).resolves.toBeNull()
  })
})
