import "fake-indexeddb/auto"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { PosDatabase } from "./database"
import { withInterTabSyncLock } from "./syncLock"

let database: PosDatabase

beforeEach(() => {
  database = new PosDatabase()
})

afterEach(async () => {
  database.close()
  await database.delete()
})

describe("withInterTabSyncLock", () => {
  it("prevents a second fallback lease from entering while the first is active", async () => {
    let releaseFirst!: () => void
    let signalFirstEntered!: () => void
    const firstTask = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const firstEntered = new Promise<void>((resolve) => {
      signalFirstEntered = resolve
    })
    let secondEntered = false

    const first = withInterTabSyncLock(async () => {
      signalFirstEntered()
      await firstTask
      return "first"
    }, database)
    await firstEntered

    const second = await withInterTabSyncLock(async () => {
      secondEntered = true
      return "second"
    }, database)

    expect(second).toBeNull()
    expect(secondEntered).toBe(false)
    releaseFirst()
    await expect(first).resolves.toBe("first")
  })

  it("releases the fallback lease after an exception", async () => {
    await expect(withInterTabSyncLock(async () => {
      throw new Error("boom")
    }, database)).rejects.toThrow("boom")

    await expect(withInterTabSyncLock(async () => "recovered", database)).resolves.toBe("recovered")
  })
})
