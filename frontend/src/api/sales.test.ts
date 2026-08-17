// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest"

import { completeSale, getSaleReceipt } from "./sales"

afterEach(() => {
  vi.restoreAllMocks()
  document.cookie = "csrftoken=; Max-Age=0; path=/"
})

describe("sales API", () => {
  it("posts only identifiers, quantities and payment details", async () => {
    document.cookie = "csrftoken=test-token; path=/"
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "sale-id",
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
          created_at: "2026-08-17T00:00:00Z",
        }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      ),
    )

    await completeSale({
      cash_session_id: "session-id",
      items: [{ product_id: "product-id", quantity: 2 }],
      payment: { method: "CASH", received_amount: "2000.00" },
    })

    const [, request] = fetchMock.mock.calls[0] ?? []
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/v1/sales/")
    expect(JSON.parse(String(request?.body))).toEqual({
      cash_session_id: "session-id",
      items: [{ product_id: "product-id", quantity: 2 }],
      payment: { method: "CASH", received_amount: "2000.00" },
    })
  })

  it("omits received_amount for a Wave payment", async () => {
    document.cookie = "csrftoken=test-token; path=/"
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "sale-id",
          status: "COMPLETED",
          subtotal: "1000.00",
          discount: "0.00",
          total: "1000.00",
          payment: {
            method: "WAVE",
            amount: "1000.00",
            received_amount: null,
            change_amount: null,
          },
          items: [],
          created_at: "2026-08-17T00:00:00Z",
        }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      ),
    )

    await completeSale({
      cash_session_id: "session-id",
      items: [{ product_id: "product-id", quantity: 2 }],
      payment: { method: "WAVE" },
    })

    const [, request] = fetchMock.mock.calls[0] ?? []
    expect(JSON.parse(String(request?.body)).payment).toEqual({ method: "WAVE" })
  })

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
})
