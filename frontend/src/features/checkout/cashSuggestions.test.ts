import { describe, expect, it } from "vitest"

import { getSuggestedCashAmounts } from "./cashSuggestions"

describe("getSuggestedCashAmounts", () => {
  it("suggests the next 500 and the notes a customer would hand over", () => {
    expect(getSuggestedCashAmounts(4_150)).toEqual([4_500, 5_000, 10_000])
  })

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

  it("reaches the next 10 000 above a larger total", () => {
    expect(getSuggestedCashAmounts(12_300)).toEqual([12_500, 15_000, 20_000])
  })

  it("never suggests the total itself nor anything below it", () => {
    for (const total of [4_500, 6_300, 10_000]) {
      for (const amount of getSuggestedCashAmounts(total)) {
        expect(amount).toBeGreaterThan(total)
      }
    }
  })

  it("returns nothing for a non-positive total", () => {
    expect(getSuggestedCashAmounts(0)).toEqual([])
    expect(getSuggestedCashAmounts(-10)).toEqual([])
  })

  it("caps suggestions at three amounts", () => {
    expect(getSuggestedCashAmounts(100).length).toBeLessThanOrEqual(3)
    expect(getSuggestedCashAmounts(123_456).length).toBeLessThanOrEqual(3)
  })
})
