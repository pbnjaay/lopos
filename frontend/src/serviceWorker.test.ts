// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest"

import { registerOfflineServiceWorker } from "./serviceWorker"

afterEach(() => {
  vi.restoreAllMocks()
})

describe("registerOfflineServiceWorker", () => {
  it("registers the root-scoped worker once the application is loaded", () => {
    const register = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { register },
    })

    registerOfflineServiceWorker()
    window.dispatchEvent(new Event("load"))

    expect(register).toHaveBeenCalledWith("/sw.js", { scope: "/" })
  })
})
