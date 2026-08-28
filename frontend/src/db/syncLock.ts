import { db, type PosDatabase } from "./database"

const SYNC_LOCK_NAME = "lopos:pending-sales-sync"
const SYNC_LEASE_KEY = "syncLease"
const SYNC_LEASE_DURATION_MS = 30_000
const SYNC_LEASE_HEARTBEAT_MS = 10_000

type SyncLease = {
  ownerId: string
  expiresAt: number
}

type LockManagerLike = {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>
}

function browserLockManager(): LockManagerLike | null {
  if (typeof navigator === "undefined") return null
  return (navigator as Navigator & { locks?: LockManagerLike }).locks ?? null
}

async function acquireLease(
  ownerId: string,
  database: PosDatabase,
): Promise<boolean> {
  return database.transaction("rw", database.metadata, async () => {
    const now = Date.now()
    const row = await database.metadata.get(SYNC_LEASE_KEY)
    const lease = row?.value as SyncLease | undefined
    if (lease && lease.ownerId !== ownerId && lease.expiresAt > now) return false

    await database.metadata.put({
      key: SYNC_LEASE_KEY,
      value: { ownerId, expiresAt: now + SYNC_LEASE_DURATION_MS } satisfies SyncLease,
      updatedAt: new Date(now).toISOString(),
    })
    return true
  })
}

async function renewLease(ownerId: string, database: PosDatabase): Promise<void> {
  await database.transaction("rw", database.metadata, async () => {
    const row = await database.metadata.get(SYNC_LEASE_KEY)
    const lease = row?.value as SyncLease | undefined
    if (lease?.ownerId !== ownerId) return
    const now = Date.now()
    await database.metadata.put({
      key: SYNC_LEASE_KEY,
      value: { ownerId, expiresAt: now + SYNC_LEASE_DURATION_MS } satisfies SyncLease,
      updatedAt: new Date(now).toISOString(),
    })
  })
}

async function releaseLease(ownerId: string, database: PosDatabase): Promise<void> {
  await database.transaction("rw", database.metadata, async () => {
    const row = await database.metadata.get(SYNC_LEASE_KEY)
    const lease = row?.value as SyncLease | undefined
    if (lease?.ownerId === ownerId) await database.metadata.delete(SYNC_LEASE_KEY)
  })
}

async function withIndexedDbLease<T>(
  task: () => Promise<T>,
  database: PosDatabase,
): Promise<T | null> {
  const ownerId = crypto.randomUUID()
  if (!(await acquireLease(ownerId, database))) return null

  const heartbeat = setInterval(() => {
    void renewLease(ownerId, database).catch(() => undefined)
  }, SYNC_LEASE_HEARTBEAT_MS)
  try {
    return await task()
  } finally {
    clearInterval(heartbeat)
    await releaseLease(ownerId, database)
  }
}

/**
 * Runs at most one pending-sales sync across all tabs in this browser profile.
 * A native Web Lock queues contenders. The IndexedDB fallback declines a
 * contender while a live lease exists; startup/reconnect/manual triggers will
 * retry naturally, and an abandoned lease expires after 30 seconds.
 */
export async function withInterTabSyncLock<T>(
  task: () => Promise<T>,
  database: PosDatabase = db,
): Promise<T | null> {
  const locks = browserLockManager()
  if (locks) {
    // Do not catch here: a rejection may come from the task itself. Falling
    // back in that case would execute a failed sync twice.
    return locks.request(SYNC_LOCK_NAME, task)
  }
  return withIndexedDbLease(task, database)
}
