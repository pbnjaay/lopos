// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"

import { act, cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ToastProvider, useToast } from "./Toast"

function Harness({ onReady }: { onReady: (api: ReturnType<typeof useToast>) => void }) {
  const toast = useToast()
  onReady(toast)
  return null
}

function renderToasts() {
  let api!: ReturnType<typeof useToast>
  render(
    <ToastProvider>
      <Harness onReady={(value) => (api = value)} />
    </ToastProvider>,
  )
  return () => api
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe("ToastProvider", () => {
  it("collapses a repeated event instead of stacking the same message", () => {
    const toast = renderToasts()

    act(() => {
      toast().info("Mode hors ligne activé")
      toast().info("Mode hors ligne activé")
      toast().info("Mode hors ligne activé")
    })

    expect(screen.getAllByText("Mode hors ligne activé")).toHaveLength(1)
  })

  it("keeps at most three notifications on screen", () => {
    const toast = renderToasts()

    act(() => {
      toast().success("Un")
      toast().success("Deux")
      toast().success("Trois")
      toast().success("Quatre")
    })

    expect(screen.queryByText("Un")).not.toBeInTheDocument()
    expect(screen.getByText("Quatre")).toBeInTheDocument()
  })

  it("expires a success sooner than an error", () => {
    vi.useFakeTimers()
    const toast = renderToasts()

    act(() => {
      toast().success("Prix modifié")
      toast().error("Enregistrement impossible")
    })

    act(() => vi.advanceTimersByTime(3_000))
    expect(screen.queryByText("Prix modifié")).not.toBeInTheDocument()
    expect(screen.getByText("Enregistrement impossible")).toBeInTheDocument()

    act(() => vi.advanceTimersByTime(5_000))
    expect(screen.queryByText("Enregistrement impossible")).not.toBeInTheDocument()
  })

  it("keeps a persistent notification until it is dismissed", async () => {
    const user = userEvent.setup()
    const toast = renderToasts()

    act(() => toast().error("Catalogue indisponible", { persistent: true }))

    await user.click(screen.getByRole("button", { name: "Fermer la notification" }))
    expect(screen.queryByText("Catalogue indisponible")).not.toBeInTheDocument()
  })

  it("announces an error assertively and the rest politely", () => {
    const toast = renderToasts()

    act(() => {
      toast().success("Vente enregistrée")
      toast().error("Enregistrement impossible")
    })

    expect(screen.getByText("Enregistrement impossible").closest("[role]")).toHaveAttribute(
      "role",
      "alert",
    )
    expect(screen.getByText("Vente enregistrée").closest("[role]")).toHaveAttribute(
      "role",
      "status",
    )
  })
})
