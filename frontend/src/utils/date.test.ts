import { describe, expect, it } from "vitest"

import { formatDateTime } from "./date"

describe("date utilities", () => {
  it("formats an API timestamp without seconds", () => {
    expect(formatDateTime("2026-08-17T08:02:00Z")).toMatch(
      /^17\/08\/2026 \d{2}:02$/,
    )
  })
})
