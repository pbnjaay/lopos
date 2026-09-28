import { describe, expect, it } from "vitest"

import type { LocalSale } from "../../db/types"
import type { PaymentMethod } from "../../types/api"
import { dominantPaymentMethod } from "./dominantPaymentMethod"

function sale(...payments: Array<[PaymentMethod, number]>): LocalSale {
  return {
    payments: payments.map(([method, amount]) => ({
      method,
      amount,
      receivedAmount: null,
      changeAmount: null,
    })),
  } as LocalSale
}

describe("dominantPaymentMethod", () => {
  it("returns nothing before the first sale", () => {
    expect(dominantPaymentMethod([])).toBeNull()
  })

  it("follows the most frequent method, not the latest one", () => {
    expect(
      dominantPaymentMethod([sale(["CASH", 500]), sale(["CASH", 700]), sale(["WAVE", 300])]),
    ).toBe("CASH")
  })

  it("counts a split payment once, for its largest part", () => {
    expect(
      dominantPaymentMethod([sale(["CASH", 200], ["WAVE", 800]), sale(["WAVE", 100])]),
    ).toBe("WAVE")
  })

  it("breaks ties in the cart footer order", () => {
    expect(dominantPaymentMethod([sale(["ORANGE_MONEY", 100]), sale(["WAVE", 100])])).toBe("WAVE")
  })
})
