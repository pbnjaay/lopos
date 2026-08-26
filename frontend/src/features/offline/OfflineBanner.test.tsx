// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ToastProvider } from "../../components/ui/Toast"
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

// Les notifications réseau passent par le système de toasts commun : elles
// sont montées avec le même provider que dans l'application.
function renderNotifications() {
  return render(
    <ToastProvider>
      <NetworkNotifications />
    </ToastProvider>,
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
    renderNotifications()

    fireEvent(window, new Event("offline"))
    expect(screen.getByText("Mode hors ligne activé")).toBeInTheDocument()
    expect(
      screen.getByText(
        "Vous pouvez continuer à vendre, les ventes sont enregistrées sur la caisse.",
      ),
    ).toBeInTheDocument()

    act(() => vi.advanceTimersByTime(4_000))
    expect(screen.queryByText("Mode hors ligne activé")).not.toBeInTheDocument()
  })

  it("does not announce an opportunistic sync after an online sale", () => {
    vi.stubGlobal("navigator", { onLine: true })
    const view = renderNotifications()

    syncState.lastOutcome = { attempted: 1, synced: 1, conflicts: 0 }
    view.rerender(
      <ToastProvider>
        <NetworkNotifications />
      </ToastProvider>,
    )

    expect(screen.queryByText("Synchronisation terminée")).not.toBeInTheDocument()
  })

  it("confirms completed sales after reconnection", () => {
    vi.stubGlobal("navigator", { onLine: false })
    const view = renderNotifications()

    fireEvent(window, new Event("online"))
    syncState.lastOutcome = { attempted: 2, synced: 2, conflicts: 0 }
    view.rerender(
      <ToastProvider>
        <NetworkNotifications />
      </ToastProvider>,
    )

    expect(screen.getByText("Synchronisation terminée")).toBeInTheDocument()
    expect(screen.getByText("2 ventes ont été envoyées au serveur.")).toBeInTheDocument()
  })
})
