// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { afterEach, describe, expect, it, vi } from "vitest"

import { LoginPage } from "./LoginPage"

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function renderLoginPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })

  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/login"]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<p>Destination authentifiée</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  vi.restoreAllMocks()
  document.cookie = "csrftoken=; Max-Age=0; path=/"
})

describe("LoginPage", () => {
  it("authenticates and redirects after a valid submission", async () => {
    const user = userEvent.setup()
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ detail: "Authentication required" }, 403))
      .mockImplementationOnce(async () => {
        document.cookie = "csrftoken=token; path=/"
        return jsonResponse({ detail: "CSRF cookie set" })
      })
      .mockResolvedValueOnce(
        jsonResponse({
          id: 1,
          username: "cashier",
          email: "",
          first_name: "",
          last_name: "",
          is_staff: false,
        }),
      )

    renderLoginPage()
    await user.type(await screen.findByLabelText("Nom d’utilisateur"), "cashier")
    await user.type(screen.getByLabelText("Mot de passe"), "secret")
    await user.click(screen.getByRole("button", { name: "Se connecter" }))

    expect(await screen.findByText("Destination authentifiée")).toBeInTheDocument()
  })

  it("keeps the form and displays the backend credential error", async () => {
    const user = userEvent.setup()
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ detail: "Authentication required" }, 403))
      .mockImplementationOnce(async () => {
        document.cookie = "csrftoken=token; path=/"
        return jsonResponse({ detail: "CSRF cookie set" })
      })
      .mockResolvedValueOnce(
        jsonResponse(
          {
            code: "INVALID_CREDENTIALS",
            message: "Nom d'utilisateur ou mot de passe incorrect.",
          },
          401,
        ),
      )

    renderLoginPage()
    await user.type(await screen.findByLabelText("Nom d’utilisateur"), "cashier")
    await user.type(screen.getByLabelText("Mot de passe"), "wrong")
    await user.click(screen.getByRole("button", { name: "Se connecter" }))

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Nom d'utilisateur ou mot de passe incorrect.",
    )
    expect(screen.getByRole("button", { name: "Se connecter" })).toBeEnabled()
  })
})
