// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen } from "@testing-library/react"
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
})
