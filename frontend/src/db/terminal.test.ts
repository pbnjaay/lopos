import "fake-indexeddb/auto"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { PosDatabase } from "./database"
import { getOrCreateTerminalId } from "./terminal"

let database: PosDatabase

beforeEach(() => {
  database = new PosDatabase()
})

afterEach(async () => {
  database.close()
  await database.delete()
})

describe("getOrCreateTerminalId", () => {
  it("generates a UUID once and persists it", async () => {
    const terminalId = await getOrCreateTerminalId(database)

    expect(terminalId).toMatch(/^[0-9a-f-]{36}$/)
    const stored = await database.metadata.get("terminalId")
    expect(stored?.value).toBe(terminalId)
  })

  it("returns the same id on every subsequent call", async () => {
    const first = await getOrCreateTerminalId(database)
    const second = await getOrCreateTerminalId(database)

    expect(second).toBe(first)
  })

  it("never regenerates the id once one has been created concurrently", async () => {
    const [first, second, third] = await Promise.all([
      getOrCreateTerminalId(database),
      getOrCreateTerminalId(database),
      getOrCreateTerminalId(database),
    ])

    expect(second).toBe(first)
    expect(third).toBe(first)
  })
})
