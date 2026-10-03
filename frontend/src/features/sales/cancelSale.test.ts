// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest"

import * as salesApi from "../../api/sales"
import * as localSales from "../../db/sales"
import { cancelSaleEverywhere } from "./cancelSale"

afterEach(() => {
  vi.restoreAllMocks()
})

describe("cancelSaleEverywhere", () => {
  it("cancels purely locally and never calls the API when the sale hasn't synced yet", async () => {
    vi.spyOn(localSales, "cancelPendingLocalSale").mockResolvedValue(true)
    const apiSpy = vi.spyOn(salesApi, "cancelSale")

    await cancelSaleEverywhere("sale-id")

    expect(apiSpy).not.toHaveBeenCalled()
  })

  it("falls back to the server once the sale has already synced", async () => {
    vi.spyOn(localSales, "cancelPendingLocalSale").mockResolvedValue(false)
    const apiSpy = vi
      .spyOn(salesApi, "cancelSale")
      .mockResolvedValue({} as Awaited<ReturnType<typeof salesApi.cancelSale>>)

    await cancelSaleEverywhere("sale-id")

    expect(apiSpy).toHaveBeenCalledWith("sale-id")
  })
})
