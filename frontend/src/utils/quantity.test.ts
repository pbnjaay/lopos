import { describe, expect, it } from "vitest"

import { formatQuantity, milliToBackendQuantity, milliToDisplayQuantity } from "./quantity"

describe("quantity formatting", () => {
  it.each([
    [1000, "1"],
    [500, "0,5"],
    [1250, "1,25"],
    [125, "0,125"],
  ])("formats %i milli-units without insignificant zeroes", (quantityMilli, expected) => {
    expect(milliToDisplayQuantity(quantityMilli)).toBe(expected)
  })

  it("keeps the fixed three-decimal format used by the backend", () => {
    expect(milliToBackendQuantity(1000)).toBe("1.000")
    expect(milliToBackendQuantity(500)).toBe("0.500")
  })

  it("adds kg only to the human-readable weighed quantity", () => {
    expect(formatQuantity(1000, "KG")).toBe("1 kg")
    expect(formatQuantity(1250, "KG")).toBe("1,25 kg")
  })
})
