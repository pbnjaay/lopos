// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest"

import { getSaleReceipt, listSales } from "./sales"

afterEach(() => {
  vi.restoreAllMocks()
  document.cookie = "csrftoken=; Max-Age=0; path=/"
})

describe("sales API", () => {
  it("gets receipt data without sending a mutation", async () => {
    const receipt = {
      id: "sale/id",
      created_at: "2026-08-17T14:32:00Z",
      store: { id: "store-id", name: "Supérette Test" },
      cash_register: { id: "register-id", name: "Caisse 01" },
      cashier: { id: 2, username: "caissier" },
      status: "COMPLETED",
      subtotal: "1000.00",
      discount: "0.00",
      total: "1000.00",
      payment: {
        method: "CASH",
        amount: "1000.00",
        received_amount: "2000.00",
        change_amount: "1000.00",
      },
      items: [],
    }
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(receipt), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    )

    await expect(getSaleReceipt("sale/id")).resolves.toEqual(receipt)

    const [, request] = fetchMock.mock.calls[0] ?? []
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/v1/sales/sale%2Fid/")
    expect(request?.method).toBe("GET")
    expect(request?.body).toBeUndefined()
  })

  it("lists sales in the scope of the selected open session", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ count: 0, next: null, previous: null, results: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    )

    await listSales({
      cashSessionId: "session-id",
      search: "A12F",
      paymentMethod: "WAVE",
      page: 2,
      pageSize: 20,
    })

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/v1/sales/?cash_session_id=session-id&search=A12F&payment_method=WAVE&page=2&page_size=20",
    )
  })
})
