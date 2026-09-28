import { describe, expect, it } from "vitest"

import { formatPhone, normalizePhone, phoneSearchDigits } from "./phone"

describe("normalizePhone", () => {
  it.each([
    "77 123 45 67",
    "771234567",
    "+221771234567",
    "+221 77 123 45 67",
    "00221771234567",
    "221771234567",
    "77.123.45.67",
    "77-123-45-67",
  ])("normalizes %s like the server", (raw) => {
    expect(normalizePhone(raw)).toBe("+221771234567")
  })

  it("accepts a Senegalese landline and explicit foreign numbers", () => {
    expect(normalizePhone("33 821 00 00")).toBe("+221338210000")
    expect(normalizePhone("+33 6 12 34 56 78")).toBe("+33612345678")
    expect(normalizePhone("0033612345678")).toBe("+33612345678")
  })

  it.each(["", "77123456", "7712345678", "671234567", "Moussa", "+221 67 123 45 67", "+12"])(
    "rejects %s",
    (raw) => {
      expect(normalizePhone(raw)).toBeNull()
    },
  )
})

describe("formatPhone", () => {
  it("groups a Senegalese number the way it is spoken", () => {
    expect(formatPhone("+221771234567")).toBe("77 123 45 67")
  })

  it("leaves foreign numbers and missing phones readable", () => {
    expect(formatPhone("+33612345678")).toBe("+33612345678")
    expect(formatPhone(null)).toBe("")
  })
})

describe("phoneSearchDigits", () => {
  it("treats digit-only input as a phone search", () => {
    expect(phoneSearchDigits("77 12")).toBe("7712")
    expect(phoneSearchDigits("+221")).toBe("221")
  })

  it("treats anything else as a name search", () => {
    expect(phoneSearchDigits("Moussa")).toBeNull()
    expect(phoneSearchDigits("7")).toBeNull()
    expect(phoneSearchDigits("")).toBeNull()
  })
})
