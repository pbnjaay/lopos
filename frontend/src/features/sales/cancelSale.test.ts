// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest"

import * as salesApi from "../../api/sales"
import * as localSales from "../../db/sales"
import type { LocalSale } from "../../db/types"
import * as syncEngine from "../../sync/syncEngine"
import { CancellationNeedsConnectionError, cancelSaleEverywhere } from "./cancelSale"

afterEach(() => {
  vi.restoreAllMocks()
})

const input = { reason: "Mauvais article" }
const synced = { id: "sale-id", serverId: "sale-id", status: "SYNCED" } as LocalSale
const pending = { id: "sale-id", serverId: null, status: "PENDING_SYNC" } as LocalSale

function mockApi() {
  return vi
    .spyOn(salesApi, "cancelSale")
    .mockResolvedValue({} as Awaited<ReturnType<typeof salesApi.cancelSale>>)
}

describe("cancelSaleEverywhere", () => {
  it("cancels a synced sale on the server, with its reason", async () => {
    vi.spyOn(localSales, "getLocalSaleById").mockResolvedValue(synced)
    const apiSpy = mockApi()

    await cancelSaleEverywhere("sale-id", input)

    expect(apiSpy).toHaveBeenCalledWith("sale-id", input)
  })

  it("pushes a pending sale to the server before cancelling it there", async () => {
    vi.spyOn(localSales, "getLocalSaleById")
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce({ ...pending, status: "SYNCED", serverId: "sale-id" })
    const syncSpy = vi
      .spyOn(syncEngine, "syncPendingSales")
      .mockResolvedValue({ attempted: 1, synced: 1, conflicts: 0 })
    const apiSpy = mockApi()

    await cancelSaleEverywhere("sale-id", { ...input, approvalToken: "token" })

    expect(syncSpy).toHaveBeenCalled()
    expect(apiSpy).toHaveBeenCalledWith("sale-id", { ...input, approvalToken: "token" })
  })

  it("never deletes a pending sale silently when it cannot reach the server", async () => {
    vi.spyOn(localSales, "getLocalSaleById").mockResolvedValue(pending)
    vi.spyOn(syncEngine, "syncPendingSales").mockResolvedValue({
      attempted: 1, synced: 0, conflicts: 0,
    })
    const apiSpy = mockApi()

    await expect(cancelSaleEverywhere("sale-id", input)).rejects.toBeInstanceOf(
      CancellationNeedsConnectionError,
    )
    expect(apiSpy).not.toHaveBeenCalled()
  })

  it("cancels a sale unknown to this terminal on the server", async () => {
    vi.spyOn(localSales, "getLocalSaleById").mockResolvedValue(null)
    const apiSpy = mockApi()

    await cancelSaleEverywhere("other-terminal-sale", input)

    expect(apiSpy).toHaveBeenCalledWith("other-terminal-sale", input)
  })
})
