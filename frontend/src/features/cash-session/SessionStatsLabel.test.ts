import { describe, expect, it } from "vitest"

import { formatSessionDuration } from "./SessionStatsLabel"

const opened = "2026-09-01T08:00:00.000Z"
const at = (isoNow: string) => new Date(isoNow).getTime()

describe("formatSessionDuration", () => {
  it("affiche les minutes sous une heure", () => {
    expect(formatSessionDuration(opened, at("2026-09-01T08:47:00.000Z"))).toBe("47 min")
  })

  it("passe en heures avec les minutes sur deux chiffres", () => {
    expect(formatSessionDuration(opened, at("2026-09-01T12:12:00.000Z"))).toBe("4 h 12")
    expect(formatSessionDuration(opened, at("2026-09-01T13:05:00.000Z"))).toBe("5 h 05")
  })

  it("passe en jours au-dela de 24 h, pour qu'une caisse oubliee se remarque", () => {
    expect(formatSessionDuration(opened, at("2026-09-09T05:14:00.000Z"))).toBe("7 j 21 h")
  })

  it("ne rend rien pour une date invalide ou dans le futur", () => {
    expect(formatSessionDuration("pas-une-date", at("2026-09-01T09:00:00.000Z"))).toBeNull()
    expect(formatSessionDuration(opened, at("2026-09-01T07:00:00.000Z"))).toBeNull()
  })
})
