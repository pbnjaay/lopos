// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ConnectionStatus, NetworkNotifications } from "./OfflineBanner"

const syncState = vi.hoisted(() => ({
  pendingCount: 0,
  conflictCount: 0,
  isSyncing: false,
  lastOutcome: null as { attempted: number; synced: number; conflicts: number } | null,
}))

vi.mock("../sync/useSyncStatus", () => ({
  useSyncStatus: () => ({
    ...syncState,
    triggerSync: vi.fn(),
  }),
}))

function renderStatus() {
  return render(
    <MemoryRouter>
      <ConnectionStatus />
    </MemoryRouter>,
  )
}

describe("network feedback", () => {
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    syncState.pendingCount = 0
    syncState.conflictCount = 0
    syncState.isSyncing = false
    syncState.lastOutcome = null
  })

  it("keeps the online state compact but explicit", () => {
    vi.stubGlobal("navigator", { onLine: true })
    renderStatus()

    expect(screen.getByRole("status", { name: "En ligne" })).toBeInTheDocument()
    expect(screen.queryByRole("link")).not.toBeInTheDocument()
  })

  it("shows a single persistent offline status without permanent guidance", () => {
    vi.stubGlobal("navigator", { onLine: false })
    renderStatus()

    expect(screen.getByRole("status", { name: "Hors ligne" })).toBeInTheDocument()
    expect(screen.queryByText(/enregistrées localement/i)).not.toBeInTheDocument()
  })

  it("integrates the pending count and route into the offline badge", () => {
    vi.stubGlobal("navigator", { onLine: false })
    syncState.pendingCount = 3
    renderStatus()

    expect(screen.getByRole("link", { name: "Hors ligne · 3 en attente" })).toHaveAttribute(
      "href",
      "/sales/pending",
    )
  })

  it("prioritizes sales needing attention", () => {
    vi.stubGlobal("navigator", { onLine: true })
    syncState.pendingCount = 2
    syncState.conflictCount = 1
    renderStatus()

    expect(screen.getByRole("link", { name: "1 vente à vérifier" })).toHaveAttribute(
      "href",
      "/sales/pending",
    )
  })

  it("keeps reconnection synchronization in the compact badge", () => {
    vi.stubGlobal("navigator", { onLine: true })
    syncState.pendingCount = 5
    syncState.isSyncing = true
    renderStatus()

    expect(screen.getByRole("link", { name: "Synchronisation… · 5" })).toHaveAttribute(
      "href",
      "/sales/pending",
    )
  })

  it("shows reassuring guidance only during an online-to-offline transition", () => {
    vi.useFakeTimers()
    vi.stubGlobal("navigator", { onLine: true })
    render(<NetworkNotifications />)

    fireEvent(window, new Event("offline"))
    expect(screen.getByText("Connexion perdue")).toBeInTheDocument()
    expect(
      screen.getByText("Les ventes continueront d’être enregistrées localement."),
    ).toBeInTheDocument()

    act(() => vi.advanceTimersByTime(5_000))
    expect(screen.queryByText("Connexion perdue")).not.toBeInTheDocument()
  })

  it("does not announce an opportunistic sync after an online sale", () => {
    vi.stubGlobal("navigator", { onLine: true })
    const view = render(<NetworkNotifications />)

    syncState.lastOutcome = { attempted: 1, synced: 1, conflicts: 0 }
    view.rerender(<NetworkNotifications />)

    expect(screen.queryByText(/vente.*synchronisée/)).not.toBeInTheDocument()
  })

  it("confirms completed sales after reconnection", () => {
    vi.stubGlobal("navigator", { onLine: false })
    const view = render(<NetworkNotifications />)

    fireEvent(window, new Event("online"))
    syncState.lastOutcome = { attempted: 2, synced: 2, conflicts: 0 }
    view.rerender(<NetworkNotifications />)

    expect(screen.getByText("2 ventes ont été synchronisées")).toBeInTheDocument()
  })
})
