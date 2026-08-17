import { db, type PosDatabase } from "./database"

const TERMINAL_ID_KEY = "terminalId"

/** Generated once per install and persisted in IndexedDB, never in localStorage. */
export async function getOrCreateTerminalId(database: PosDatabase = db): Promise<string> {
  return database.transaction("rw", database.metadata, async () => {
    const existing = await database.metadata.get(TERMINAL_ID_KEY)
    if (existing && typeof existing.value === "string") return existing.value

    const terminalId = crypto.randomUUID()
    await database.metadata.put({
      key: TERMINAL_ID_KEY,
      value: terminalId,
      updatedAt: new Date().toISOString(),
    })
    return terminalId
  })
}
