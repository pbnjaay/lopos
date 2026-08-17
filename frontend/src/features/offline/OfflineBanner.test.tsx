// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"

import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { OfflineBanner } from "./OfflineBanner"

describe("OfflineBanner", () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it("shows the online status without a pending detail when nothing is queued", () => {
    vi.stubGlobal("navigator", { onLine: true })
    render(<OfflineBanner />)

    expect(screen.getByText("En ligne")).toBeInTheDocument()
    expect(screen.queryByText(/en attente de synchronisation/)).not.toBeInTheDocument()
  })

  it("shows the offline status and instructions", () => {
    vi.stubGlobal("navigator", { onLine: false })
    render(<OfflineBanner />)

    expect(screen.getByText("Hors ligne")).toBeInTheDocument()
    expect(screen.getByText("Les ventes sont enregistrées localement.")).toBeInTheDocument()
  })

  it("shows the pending sales count when offline", () => {
    vi.stubGlobal("navigator", { onLine: false })
    render(<OfflineBanner pendingSalesCount={3} />)

    expect(screen.getByText("3 ventes en attente de synchronisation")).toBeInTheDocument()
  })

  it("shows the pending sales count even once back online", () => {
    vi.stubGlobal("navigator", { onLine: true })
    render(<OfflineBanner pendingSalesCount={1} />)

    expect(screen.getByText("En ligne")).toBeInTheDocument()
    expect(screen.getByText("1 vente en attente de synchronisation")).toBeInTheDocument()
  })
})
