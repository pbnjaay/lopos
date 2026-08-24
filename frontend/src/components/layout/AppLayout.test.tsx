// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { afterEach, describe, expect, it } from "vitest"

import type { CurrentUser } from "../../types/api"
import { AppLayout } from "./AppLayout"

const user: CurrentUser = {
  id: 7,
  username: "cashier",
  email: "",
  first_name: "Awa",
  last_name: "",
  is_staff: false,
}

afterEach(cleanup)

describe("AppLayout", () => {
  it("uses the brand as the application home link", () => {
    const queryClient = new QueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/pos"]}>
          <Routes>
            <Route element={<AppLayout user={user} />}>
              <Route path="/pos" element={<p>Point de vente</p>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(screen.getByRole("link", { name: "LoPOS — Accueil" })).toHaveAttribute("href", "/")
  })

  it("groups sales, closing and logout actions in the user menu", async () => {
    const userEvents = userEvent.setup()
    const queryClient = new QueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/pos"]}>
          <Routes>
            <Route element={<AppLayout user={user} />}>
              <Route path="/pos" element={<p>Point de vente</p>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(screen.queryByRole("link", { name: "Ventes" })).not.toBeInTheDocument()
    await userEvents.click(screen.getByRole("button", { name: "Menu de session — Awa" }))

    expect(screen.getByRole("link", { name: "Ventes" })).toHaveAttribute("href", "/sales")
    expect(screen.getByRole("link", { name: "Clôturer la caisse" })).toHaveAttribute(
      "href",
      "/cash/close",
    )
    expect(screen.getByRole("button", { name: "Se déconnecter" })).toBeInTheDocument()

    fireEvent.keyDown(document, { key: "Escape" })
    expect(screen.queryByRole("link", { name: "Ventes" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Menu de session — Awa" })).toHaveFocus()
  })
})
