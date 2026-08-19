import { describe, expect, it } from "vitest"

import { getSuggestedCashAmounts } from "./cashSuggestions"

describe("getSuggestedCashAmounts", () => {
  it("suggests a round-up amount for a sub-1000 total", () => {
    expect(getSuggestedCashAmounts(700)).toContain(1_000)
  })

  it("suggests the nearest 500 above the total plus larger notes", () => {
    const suggestions = getSuggestedCashAmounts(2_200)
    expect(suggestions).toContain(2_500)
    expect(suggestions).toContain(5_000)
  })

  it("suggests a round-up amount and a larger note for a mid-size total", () => {
    const suggestions = getSuggestedCashAmounts(6_300)
    expect(suggestions.some((amount) => amount >= 6_300 && amount <= 7_000)).toBe(true)
    expect(suggestions).toContain(10_000)
  })

  it("never suggests an amount below the total", () => {
    for (const amount of getSuggestedCashAmounts(6_300)) {
      expect(amount).toBeGreaterThanOrEqual(6_300)
    }
  })

  it("returns nothing for a non-positive total", () => {
    expect(getSuggestedCashAmounts(0)).toEqual([])
    expect(getSuggestedCashAmounts(-10)).toEqual([])
  })

  it("caps suggestions at four amounts", () => {
    expect(getSuggestedCashAmounts(100).length).toBeLessThanOrEqual(4)
  })
})
