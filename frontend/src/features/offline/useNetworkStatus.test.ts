// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { useNetworkStatus } from "./useNetworkStatus"

describe("useNetworkStatus", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("reflects the initial navigator.onLine value", () => {
    vi.stubGlobal("navigator", { onLine: false })
    const { result } = renderHook(() => useNetworkStatus())
    expect(result.current).toBe(false)
  })

  it("switches to offline when the browser fires the offline event", () => {
    vi.stubGlobal("navigator", { onLine: true })
    const { result } = renderHook(() => useNetworkStatus())
    expect(result.current).toBe(true)

    act(() => {
      window.dispatchEvent(new Event("offline"))
    })
    expect(result.current).toBe(false)
  })

  it("switches back to online when the browser fires the online event", () => {
    vi.stubGlobal("navigator", { onLine: false })
    const { result } = renderHook(() => useNetworkStatus())
    expect(result.current).toBe(false)

    act(() => {
      window.dispatchEvent(new Event("online"))
    })
    expect(result.current).toBe(true)
  })
})
