import { describe, expect, it } from "vitest"

import { describeSyncNotice } from "./syncCopy"

describe("describeSyncNotice", () => {
  it("is a success only when everything was sent", () => {
    expect(describeSyncNotice({ attempted: 2, synced: 2, conflicts: 0 }, 0)).toEqual({
      tone: "success",
      title: "Synchronisation terminée",
      description: "2 ventes synchronisées.",
    })
  })

  it("warns when the server did not answer and sales are still pending", () => {
    const notice = describeSyncNotice({ attempted: 0, synced: 0, conflicts: 0 }, 3)
    expect(notice.tone).toBe("warning")
    expect(notice.title).toBe("Synchronisation incomplète")
    expect(notice.description).toBe(
      "Le serveur n’a pas répondu. 3 ventes encore en attente, réessayez dans un instant.",
    )
  })

  it("warns on a partial sync", () => {
    const notice = describeSyncNotice({ attempted: 1, synced: 1, conflicts: 0 }, 1)
    expect(notice.tone).toBe("warning")
    expect(notice.description).toBe(
      "1 vente synchronisée. 1 vente encore en attente, réessayez dans un instant.",
    )
  })

  it("warns about conflicts first", () => {
    const notice = describeSyncNotice({ attempted: 2, synced: 1, conflicts: 1 }, 0)
    expect(notice).toEqual({
      tone: "warning",
      title: "1 vente à vérifier",
      description: "1 vente synchronisée, 1 à vérifier.",
    })
  })

  it("says there was nothing to do instead of a green success", () => {
    expect(describeSyncNotice({ attempted: 0, synced: 0, conflicts: 0 }, 0).tone).toBe("info")
  })
})
