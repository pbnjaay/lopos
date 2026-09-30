// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { THEME_PREFERENCE_KEY, getThemePreference, initTheme, setThemePreference } from "./theme"

function mockSystemDark(matches: boolean) {
  const listeners: Array<() => void> = []
  const query = {
    get matches() {
      return matches
    },
    addEventListener: (_: string, listener: () => void) => listeners.push(listener),
  }
  vi.stubGlobal("matchMedia", () => query)
  return {
    change(next: boolean) {
      matches = next
      listeners.forEach((listener) => listener())
    },
  }
}

beforeEach(() => {
  document.head.innerHTML = '<meta name="theme-color" content="#176b4d" />'
  delete document.documentElement.dataset.theme
  localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function themeColor() {
  return document.querySelector('meta[name="theme-color"]')?.getAttribute("content")
}

describe("theme", () => {
  it("defaults to light even when the system prefers dark", () => {
    mockSystemDark(true)

    initTheme()

    expect(getThemePreference()).toBe("light")
    expect(document.documentElement.dataset.theme).toBe("light")
    expect(themeColor()).toBe("#176b4d")
  })

  it("persists the dark preference per terminal and updates the status bar color", () => {
    mockSystemDark(false)

    setThemePreference("dark")

    expect(localStorage.getItem(THEME_PREFERENCE_KEY)).toBe("dark")
    expect(document.documentElement.dataset.theme).toBe("dark")
    expect(themeColor()).toBe("#121a16")
  })

  it("follows the system while the system preference is chosen", () => {
    const system = mockSystemDark(false)
    localStorage.setItem(THEME_PREFERENCE_KEY, "system")

    initTheme()
    expect(document.documentElement.dataset.theme).toBe("light")

    system.change(true)
    expect(document.documentElement.dataset.theme).toBe("dark")
  })

  it("ignores system changes once an explicit theme is chosen", () => {
    const system = mockSystemDark(false)
    initTheme()
    setThemePreference("light")

    system.change(true)

    expect(document.documentElement.dataset.theme).toBe("light")
  })

  it("falls back to light for an unknown stored value", () => {
    localStorage.setItem(THEME_PREFERENCE_KEY, "sepia")

    expect(getThemePreference()).toBe("light")
  })
})
