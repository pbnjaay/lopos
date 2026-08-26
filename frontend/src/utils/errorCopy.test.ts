import { describe, expect, it } from "vitest"

import { ApiError, NetworkError } from "../api/client"
import { describeError, describeErrorShort } from "./errorCopy"

describe("describeError", () => {
  it("never surfaces a technical failure to the cashier", () => {
    const technical = [
      new TypeError("Failed to fetch"),
      new Error("NetworkError when attempting to fetch resource"),
      new ApiError(500, { detail: "Internal Server Error" }),
      new ApiError(502, null),
    ]

    for (const error of technical) {
      const copy = describeError(error)
      const rendered = `${copy.title} ${copy.description}`
      expect(rendered).not.toMatch(/TypeError|NetworkError|Failed to fetch|HTTP|500|502/)
    }
  })

  it("tells an offline cashier what still works instead of blaming the connection", () => {
    const copy = describeError(new NetworkError(), "retour")

    expect(copy.title).toBe("Mode hors ligne")
    expect(copy.description).toContain("Vous pouvez continuer à vendre")
    expect(copy.description).not.toContain("Vérifiez votre connexion")
    expect(copy.canRetry).toBe(true)
  })

  it("adapts the offline wording to the screen that failed", () => {
    expect(describeErrorShort(new NetworkError(), "catalogue")).toContain("catalogue")
    expect(describeErrorShort(new NetworkError(), "historique")).toContain("historique")
    expect(describeErrorShort(new NetworkError(), "cloture")).toContain("clôture")
  })

  it("keeps a structured business message written by the backend", () => {
    const error = new ApiError(409, {
      code: "CASH_SESSION_ALREADY_CLOSED",
      message: "Cette session de caisse est déjà clôturée.",
    })

    expect(describeErrorShort(error)).toBe("Cette session de caisse est déjà clôturée.")
  })

  it("rewrites a bare DRF detail, which is not cashier-facing copy", () => {
    const error = new ApiError(403, { detail: "Authentication credentials were not provided." })

    expect(describeErrorShort(error)).not.toContain("Authentication credentials")
    expect(describeError(error).title).toBe("Accès refusé")
    expect(describeError(error).canRetry).toBe(false)
  })
})
