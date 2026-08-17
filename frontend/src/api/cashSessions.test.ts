// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest"

import { closeCashSession, getCashSessionSummary } from "./cashSessions"

const summary = {
  id: "session/id",
  status: "OPEN",
  cash_register: { id: "register-id", name: "Caisse 01" },
  cashier: { id: 2, username: "caissier" },
  opened_at: "2026-08-17T08:02:00Z",
  sales_count: 3,
  gross_sales: "43000.00",
  payments: {
    cash: "15000.00",
    wave: "20000.00",
    orange_money: "8000.00",
  },
  opening_balance: "15000.00",
  expected_cash: "30000.00",
  counted_cash: null,
  cash_difference: null,
  closed_at: null,
}

afterEach(() => {
  vi.restoreAllMocks()
  document.cookie = "csrftoken=; Max-Age=0; path=/"
})

describe("cash session API", () => {
  it("gets a session summary from the encoded detail route", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(summary), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    )

    await expect(getCashSessionSummary("session/id")).resolves.toEqual(summary)
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/v1/cash-sessions/session%2Fid/summary/",
    )
  })

  it("closes a session with counted_cash as the only submitted value", async () => {
    document.cookie = "csrftoken=test-token; path=/"
    const closedSummary = {
      ...summary,
      status: "CLOSED",
      counted_cash: "29500.00",
      cash_difference: "-500.00",
      closed_at: "2026-08-17T18:00:00Z",
    }
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(closedSummary), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    )

    await expect(
      closeCashSession("session-id", { counted_cash: "29500.00" }),
    ).resolves.toEqual(closedSummary)

    const [, request] = fetchMock.mock.calls[0] ?? []
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/v1/cash-sessions/session-id/close/",
    )
    expect(request?.method).toBe("POST")
    expect(JSON.parse(String(request?.body))).toEqual({ counted_cash: "29500.00" })
  })
})
