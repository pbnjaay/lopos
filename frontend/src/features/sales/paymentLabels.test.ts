import { describe, expect, it } from "vitest"

import { describeSettlement } from "./paymentLabels"

describe("describeSettlement", () => {
  it("lists the payment methods, then the book", () => {
    expect(describeSettlement([{ method: "CASH" }, { method: "WAVE" }], 0)).toBe("Espèces + Wave")
    expect(describeSettlement([{ method: "CASH" }], 6_000)).toBe("Espèces + Cahier")
  })

  it("names a sale put entirely on the book", () => {
    expect(describeSettlement([], 5_000)).toBe("Cahier")
  })
})
