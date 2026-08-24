// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"

import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ConnectionStatus, OfflineBanner } from "./OfflineBanner"

describe("OfflineBanner", () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it("keeps a discreet icon-only indicator while online", () => {
    vi.stubGlobal("navigator", { onLine: true })
    render(<ConnectionStatus />)

    expect(screen.queryByText("En ligne")).not.toBeInTheDocument()
    expect(screen.getByRole("status")).toHaveAccessibleName("Connexion Internet disponible")
    expect(screen.getByRole("status")).toHaveAttribute("title", "Connexion Internet disponible")
  })

  it("shows the offline status in the global connection indicator", () => {
    vi.stubGlobal("navigator", { onLine: false })
    render(<ConnectionStatus />)

    expect(screen.getByText("Hors ligne")).toBeInTheDocument()
    expect(screen.getByRole("status")).toHaveAccessibleName("Sans connexion Internet")
  })

  it("keeps offline operational guidance close to the POS", () => {
    vi.stubGlobal("navigator", { onLine: false })
    render(<OfflineBanner />)

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

    expect(screen.getByText("1 vente en attente de synchronisation")).toBeInTheDocument()
  })

  it("renders no duplicate status in the POS when everything is synchronized", () => {
    vi.stubGlobal("navigator", { onLine: true })
    const { container } = render(<OfflineBanner />)

    expect(container).toBeEmptyDOMElement()
  })
})
