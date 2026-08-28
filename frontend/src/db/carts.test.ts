// @vitest-environment jsdom

import "fake-indexeddb/auto"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { PosDatabase } from "./database"
import {
  ActiveCartNotEmptyError,
  ensureActiveCart,
  deleteHeldCart,
  getSessionCartBlockers,
  holdActiveCart,
  listHeldCarts,
  resumeHeldCart,
  saveActiveCartItems,
} from "./carts"
import { loadCartForSession, saveCartForSession } from "../features/cart/cartStorage"
import type { LocalCartItem } from "./types"

let database: PosDatabase

const coca: LocalCartItem = {
  productId: "coca-id",
  name: "Coca 50cl",
  unitPrice: 500,
  catalogUnitPrice: 500,
  saleUnit: "UNIT",
  quantityMilli: 2000,
  stockMilli: 20_000,
}

const banana: LocalCartItem = {
  productId: "banana-id",
  name: "Banane",
  unitPrice: 700,
  catalogUnitPrice: 700,
  saleUnit: "KG",
  quantityMilli: 750,
  stockMilli: 10_000,
}

beforeEach(async () => {
  database = new PosDatabase()
  await database.carts.clear()
})

afterEach(async () => {
  localStorage.clear()
  database.close()
  await database.delete()
})

describe("ensureActiveCart", () => {
  it("creates an empty active cart on first use", async () => {
    const cart = await ensureActiveCart("session-a", database)
    expect(cart.status).toBe("ACTIVE")
    expect(cart.items).toEqual([])
  })

  it("returns the same active cart on a second call", async () => {
    const first = await ensureActiveCart("session-a", database)
    const second = await ensureActiveCart("session-a", database)
    expect(second.id).toBe(first.id)
  })

  it("adopts a cart left in localStorage and clears it", async () => {
    saveCartForSession("session-a", [coca])

    const cart = await ensureActiveCart("session-a", database)

    expect(cart.items).toEqual([coca])
    expect(loadCartForSession("session-a")).toEqual([])
  })
})

describe("saveActiveCartItems", () => {
  it("persists items and survives a reload of the database", async () => {
    await ensureActiveCart("session-a", database)
    await saveActiveCartItems("session-a", [coca, banana], database)

    const reloaded = await ensureActiveCart("session-a", database)
    expect(reloaded.items).toEqual([coca, banana])
  })

  it("preserves a price override and a KG fractional quantity exactly", async () => {
    await ensureActiveCart("session-a", database)
    const overridden: LocalCartItem = { ...banana, unitPrice: 650 }
    await saveActiveCartItems("session-a", [overridden], database)

    const reloaded = await ensureActiveCart("session-a", database)
    expect(reloaded.items[0]).toMatchObject({
      unitPrice: 650,
      catalogUnitPrice: 700,
      saleUnit: "KG",
      quantityMilli: 750,
    })
  })
})

describe("holdActiveCart", () => {
  it("moves a non-empty active cart to HELD and opens a fresh empty active cart", async () => {
    await ensureActiveCart("session-a", database)
    await saveActiveCartItems("session-a", [coca], database)

    await holdActiveCart("session-a", database)

    const held = await listHeldCarts("session-a", database)
    expect(held).toHaveLength(1)
    expect(held[0]?.items).toEqual([coca])
    expect(held[0]?.heldAt).not.toBeNull()

    const active = await ensureActiveCart("session-a", database)
    expect(active.items).toEqual([])
    expect(active.id).not.toBe(held[0]?.id)
  })

  it("does nothing when the active cart is empty", async () => {
    await ensureActiveCart("session-a", database)
    await holdActiveCart("session-a", database)
    expect(await listHeldCarts("session-a", database)).toHaveLength(0)
  })

  it("lists the most recently held cart first", async () => {
    await ensureActiveCart("session-a", database)
    await saveActiveCartItems("session-a", [coca], database)
    await holdActiveCart("session-a", database)
    await saveActiveCartItems("session-a", [banana], database)
    await holdActiveCart("session-a", database)

    const held = await listHeldCarts("session-a", database)
    expect(held.map((cart) => cart.items[0]?.productId)).toEqual(["banana-id", "coca-id"])
  })
})

describe("resumeHeldCart", () => {
  it("swaps the held cart's items into the (empty) active cart and removes the held row", async () => {
    await ensureActiveCart("session-a", database)
    await saveActiveCartItems("session-a", [coca], database)
    await holdActiveCart("session-a", database)
    const [held] = await listHeldCarts("session-a", database)

    const resumed = await resumeHeldCart(held!.id, "session-a", [coca], database)

    expect(resumed.status).toBe("ACTIVE")
    expect(resumed.items).toEqual([coca])
    expect(await listHeldCarts("session-a", database)).toHaveLength(0)
  })

  it("writes the caller-supplied revalidated items, never the held cart's raw snapshot", async () => {
    await ensureActiveCart("session-a", database)
    await saveActiveCartItems("session-a", [coca], database)
    await holdActiveCart("session-a", database)
    const [held] = await listHeldCarts("session-a", database)

    const clamped: LocalCartItem = { ...coca, quantityMilli: 1000, quantity: 1 }
    const resumed = await resumeHeldCart(held!.id, "session-a", [clamped], database)

    expect(resumed.items).toEqual([clamped])
  })

  it("refuses to resume onto a non-empty active cart", async () => {
    await ensureActiveCart("session-a", database)
    await saveActiveCartItems("session-a", [coca], database)
    await holdActiveCart("session-a", database)
    const [held] = await listHeldCarts("session-a", database)
    // Something re-added an item to the fresh active cart in the meantime.
    await saveActiveCartItems("session-a", [banana], database)

    await expect(resumeHeldCart(held!.id, "session-a", [coca], database)).rejects.toThrow(
      ActiveCartNotEmptyError,
    )
  })

  it("refuses to resume a held cart belonging to a different session", async () => {
    await ensureActiveCart("session-a", database)
    await saveActiveCartItems("session-a", [coca], database)
    await holdActiveCart("session-a", database)
    const [held] = await listHeldCarts("session-a", database)

    await ensureActiveCart("session-b", database)
    await expect(resumeHeldCart(held!.id, "session-b", [coca], database)).rejects.toThrow()
  })
})

describe("deleteHeldCart", () => {
  it("removes a held cart", async () => {
    await ensureActiveCart("session-a", database)
    await saveActiveCartItems("session-a", [coca], database)
    await holdActiveCart("session-a", database)
    const [held] = await listHeldCarts("session-a", database)

    await deleteHeldCart(held!.id, "session-a", database)

    expect(await listHeldCarts("session-a", database)).toHaveLength(0)
  })

  it("never deletes the active cart even if called with its id", async () => {
    const active = await ensureActiveCart("session-a", database)
    await saveActiveCartItems("session-a", [coca], database)

    await deleteHeldCart(active.id, "session-a", database)

    const stillActive = await ensureActiveCart("session-a", database)
    expect(stillActive.items).toEqual([coca])
  })
})

describe("getSessionCartBlockers", () => {
  it("reports zero blockers for a fresh session", async () => {
    await ensureActiveCart("session-a", database)
    expect(await getSessionCartBlockers("session-a", database)).toEqual({
      activeItemCount: 0,
      heldCount: 0,
    })
  })

  it("reports a non-empty active cart", async () => {
    await ensureActiveCart("session-a", database)
    await saveActiveCartItems("session-a", [coca], database)
    expect(await getSessionCartBlockers("session-a", database)).toEqual({
      activeItemCount: 1,
      heldCount: 0,
    })
  })

  it("reports held carts even once the active cart is empty again", async () => {
    await ensureActiveCart("session-a", database)
    await saveActiveCartItems("session-a", [coca], database)
    await holdActiveCart("session-a", database)
    expect(await getSessionCartBlockers("session-a", database)).toEqual({
      activeItemCount: 0,
      heldCount: 1,
    })
  })
})
