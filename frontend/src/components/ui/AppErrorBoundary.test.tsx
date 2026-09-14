// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"

import { render, screen } from "@testing-library/react"
import { RouterProvider, createMemoryRouter } from "react-router-dom"
import { afterEach, describe, expect, it, vi } from "vitest"

import { AppErrorFallback, RouterErrorBoundary } from "./AppErrorBoundary"
import { Sentry } from "../../analytics/sentry"

vi.mock("../../analytics/sentry", () => ({
  Sentry: { captureException: vi.fn() },
}))

afterEach(() => {
  vi.clearAllMocks()
})

describe("AppErrorFallback", () => {
  it("offers a retry and a return-to-POS action", () => {
    render(<AppErrorFallback />)

    expect(screen.getByText("Un problème inattendu est survenu")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Réessayer" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Retour au point de vente" })).toBeInTheDocument()
  })
})

describe("RouterErrorBoundary", () => {
  it("reports the route error to Sentry and shows the branded fallback instead of react-router's default", () => {
    const boom = new Error("e.filter is not a function")
    function Crash(): never {
      throw boom
    }
    const memoryRouter = createMemoryRouter(
      [{ path: "/", element: <Crash />, errorElement: <RouterErrorBoundary /> }],
      { initialEntries: ["/"] },
    )

    render(<RouterProvider router={memoryRouter} />)

    // React 19 réinvoque en double, en dev, le composant qui a jeté avant de
    // rendre le errorElement — d'où potentiellement plusieurs occurrences
    // dans le DOM de test. Le comportement produit reste : jamais le repli
    // "Hey developer" de React Router, toujours le nôtre.
    expect(screen.getAllByText("Un problème inattendu est survenu").length).toBeGreaterThan(0)
    expect(screen.queryByText(/Hey developer/i)).not.toBeInTheDocument()
    expect(Sentry.captureException).toHaveBeenCalledWith(boom, {
      tags: { boundary: "router" },
    })
  })
})
