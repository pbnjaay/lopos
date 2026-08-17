import { describe, expect, it } from "vitest"

import { formatBackendMoney, formatMoney, parseMoneyInput, toBackendMoney } from "./money"

describe("money utilities", () => {
  it("formats integer FCFA amounts consistently", () => {
    expect(formatMoney(15_000)).toBe("15 000 FCFA")
    expect(formatBackendMoney("43000.00")).toBe("43 000 FCFA")
  })

  it("parses spaces but rejects decimals and negative amounts", () => {
    expect(parseMoneyInput("15 000")).toBe(15_000)
    expect(parseMoneyInput("0")).toBe(0)
    expect(parseMoneyInput("15.50")).toBeNull()
    expect(parseMoneyInput("-1")).toBeNull()
  })

  it("serializes the integer amount for Django Decimal", () => {
    expect(toBackendMoney(15_000)).toBe("15000.00")
  })
})
