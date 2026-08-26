// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { afterEach, describe, expect, it, vi } from "vitest"

import { listSales } from "../api/sales"
import type { CashRegister, CashSession, CurrentUser } from "../types/api"
import { formatDate } from "../utils/date"
import { SalesPage } from "./SalesPage"

vi.mock("../api/sales", () => ({ listSales: vi.fn() }))

const user: CurrentUser = {
  id: 7,
  username: "admin",
  email: "",
  first_name: "Awa",
  last_name: "",
  is_staff: true,
}

const register: CashRegister = {
  id: "register-a",
  store_id: "store-a",
  name: "Caisse A",
  is_active: true,
  created_at: "2026-08-24T10:00:00Z",
  updated_at: "2026-08-24T10:00:00Z",
}

const session: CashSession = {
  id: "session-a",
  cash_register_id: register.id,
  cashier_id: user.id,
  opening_balance: "10000.00",
  status: "OPEN",
  opened_at: "2026-08-24T10:00:00Z",
  closing_balance: null,
  expected_balance: null,
  difference: null,
  closed_at: null,
}

vi.mock("../features/auth/queries", () => ({
  useCurrentUser: () => ({ data: user }),
}))

vi.mock("../features/cash-session/queries", () => ({
  usePosSession: () => ({
    ownSession: session,
    selectedRegister: register,
    localSession: { storeName: "Boutique A" },
  }),
}))

vi.mock("../features/offline/useNetworkStatus", () => ({
  useNetworkStatus: () => true,
}))

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/sales"]}>
        <Routes>
          <Route path="/sales" element={<SalesPage />} />
          <Route path="/sales/:saleId" element={<p>Détail de la vente</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function saleFixture(id: string, overrides: Partial<Awaited<ReturnType<typeof listSales>>["results"][number]> = {}) {
  return {
    id,
    created_at: "2026-08-24T12:00:00Z",
    store: { id: "store-a", name: "Boutique A" },
    cash_register: { id: "register-a", name: "Caisse A" },
    cashier: { id: 8, username: "collegue" },
    status: "COMPLETED" as const,
    total: "2000.00",
    returned_total: "0.00",
    net_total: "2000.00",
    payment: {
      method: "CASH" as const,
      amount: "2000.00",
      received_amount: "2000.00",
      change_amount: "0.00",
    },
    ...overrides,
  }
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("SalesPage", () => {
  it("loads only through the current open cash session and links to sale details", async () => {
    vi.mocked(listSales).mockResolvedValue({
      count: 1,
      next: null,
      previous: null,
      results: [{
        id: "a12f0000-0000-0000-0000-000000000000",
        created_at: "2026-08-24T12:00:00Z",
        store: { id: "store-a", name: "Boutique A" },
        cash_register: { id: "register-a", name: "Caisse A" },
        cashier: { id: 8, username: "collegue" },
        status: "COMPLETED",
        total: "2000.00",
        returned_total: "500.00",
        net_total: "1500.00",
        payment: { method: "WAVE", amount: "2000.00", received_amount: null, change_amount: null },
      }],
    })

    renderPage()

    expect(screen.getByRole("link", { name: "Retour au point de vente" })).toHaveAttribute("href", "/pos")
    expect(await screen.findByRole("link", { name: /Ticket A12F0000/ })).toHaveAttribute(
      "href",
      "/sales/a12f0000-0000-0000-0000-000000000000",
    )
    expect(screen.getByText("Boutique A · Caisse A")).toBeInTheDocument()
    expect(screen.getByText(/Déjà retourné : 500 FCFA/)).toBeInTheDocument()
    await waitFor(() => expect(listSales).toHaveBeenCalledWith(expect.objectContaining({ cashSessionId: "session-a" })))
  })

  it("shows numbered pagination and loads the selected page", async () => {
    const userEvents = userEvent.setup()
    vi.mocked(listSales).mockResolvedValue({
      count: 200,
      next: "/api/v1/sales/?page=2",
      previous: null,
      results: [{
        id: "a12f0000-0000-0000-0000-000000000000",
        created_at: "2026-08-24T12:00:00Z",
        store: { id: "store-a", name: "Boutique A" },
        cash_register: { id: "register-a", name: "Caisse A" },
        cashier: { id: 8, username: "collegue" },
        status: "COMPLETED",
        total: "2000.00",
        returned_total: "0.00",
        net_total: "2000.00",
        payment: { method: "CASH", amount: "2000.00", received_amount: "2000.00", change_amount: "0.00" },
      }],
    })

    renderPage()

    const pagination = await screen.findByRole("navigation", { name: "Pagination des ventes" })
    expect(screen.getByRole("button", { name: "Page précédente" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Page 1" })).toHaveAttribute("aria-current", "page")
    expect(screen.getByRole("button", { name: "Page 10" })).toBeInTheDocument()
    expect(pagination).toHaveTextContent("…")

    await userEvents.click(screen.getByRole("button", { name: "Page 5" }))

    await waitFor(() => expect(listSales).toHaveBeenCalledWith(expect.objectContaining({
      page: 5,
      pageSize: 20,
    })))
    expect(screen.getByRole("button", { name: "Page 5" })).toHaveAttribute("aria-current", "page")
  })

  it("searches as the cashier types, without asking for a click", async () => {
    const userEvents = userEvent.setup()
    vi.mocked(listSales).mockResolvedValue({
      count: 1,
      next: null,
      previous: null,
      results: [saleFixture("a12f0000-0000-0000-0000-000000000000")],
    })

    renderPage()
    await screen.findByRole("link", { name: /Ticket A12F0000/ })

    expect(screen.queryByRole("button", { name: "Rechercher" })).not.toBeInTheDocument()
    expect(screen.getByLabelText("Numéro du ticket")).toHaveFocus()

    await userEvents.type(screen.getByLabelText("Numéro du ticket"), "A12F")

    await waitFor(() =>
      expect(listSales).toHaveBeenCalledWith(expect.objectContaining({ search: "A12F" })),
    )
  })

  it("moves through the sales with the arrows and opens the aimed one with Enter", async () => {
    const userEvents = userEvent.setup()
    vi.mocked(listSales).mockResolvedValue({
      count: 2,
      next: null,
      previous: null,
      results: [
        saleFixture("a12f0000-0000-0000-0000-000000000000"),
        saleFixture("b34e0000-0000-0000-0000-000000000000"),
      ],
    })

    renderPage()
    const first = await screen.findByRole("link", { name: /Ticket A12F0000/ })
    const second = screen.getByRole("link", { name: /Ticket B34E0000/ })

    // Le surlignage est visuel : `aria-current` annoncerait « page courante »,
    // ce que la ligne visée n'est pas.
    expect(first).toHaveAttribute("data-highlighted", "true")
    expect(first).not.toHaveAttribute("aria-current")
    expect(second).not.toHaveAttribute("data-highlighted")

    await userEvents.keyboard("{ArrowDown}")
    expect(screen.getByRole("link", { name: /Ticket B34E0000/ })).toHaveAttribute("data-highlighted", "true")

    await userEvents.keyboard("{Enter}")
    expect(await screen.findByText("Détail de la vente")).toBeInTheDocument()
  })

  it("announces the aimed sale, since the focus never leaves the search field", async () => {
    const userEvents = userEvent.setup()
    vi.mocked(listSales).mockResolvedValue({
      count: 2,
      next: null,
      previous: null,
      results: [
        saleFixture("a12f0000-0000-0000-0000-000000000000", { net_total: "1500.00" }),
        saleFixture("b34e0000-0000-0000-0000-000000000000", { net_total: "2000.00" }),
      ],
    })

    renderPage()
    await screen.findByRole("link", { name: /Ticket A12F0000/ })

    expect(screen.getByText(/Vente visée/)).toHaveTextContent(
      "Vente visée : ticket A12F0000, Espèces, 1 500 FCFA",
    )

    await userEvents.keyboard("{ArrowDown}")
    expect(screen.getByText(/Vente visée/)).toHaveTextContent(
      "Vente visée : ticket B34E0000, Espèces, 2 000 FCFA",
    )
  })

  it("refuses to open a sale from the previous search while the new one is pending", async () => {
    const userEvents = userEvent.setup()
    vi.mocked(listSales).mockResolvedValue({
      count: 1,
      next: null,
      previous: null,
      results: [saleFixture("a12f0000-0000-0000-0000-000000000000")],
    })

    renderPage()
    await screen.findByRole("link", { name: /Ticket A12F0000/ })

    // Le caissier saisit une autre référence et valide aussitôt : les lignes
    // affichées sont encore celles de la recherche précédente.
    await userEvents.type(screen.getByLabelText("Numéro du ticket"), "B34E{Enter}")

    expect(screen.queryByText("Détail de la vente")).not.toBeInTheDocument()
    expect(screen.getByText("Recherche en cours…")).toBeInTheDocument()
  })

  it("resets to the first page when a filter changes, without querying the old page", async () => {
    const userEvents = userEvent.setup()
    vi.mocked(listSales).mockResolvedValue({
      count: 200,
      next: null,
      previous: null,
      results: [saleFixture("a12f0000-0000-0000-0000-000000000000")],
    })

    renderPage()
    await screen.findByRole("navigation", { name: "Pagination des ventes" })
    await userEvents.click(screen.getByRole("button", { name: "Page 5" }))
    await waitFor(() =>
      expect(listSales).toHaveBeenCalledWith(expect.objectContaining({ page: 5 })),
    )

    vi.mocked(listSales).mockClear()
    await userEvents.selectOptions(screen.getByLabelText("Paiement"), "WAVE")

    await waitFor(() =>
      expect(listSales).toHaveBeenCalledWith(
        expect.objectContaining({ paymentMethod: "WAVE", page: 1 }),
      ),
    )
    // Aucune requête ne part pour le nouveau filtre sur l'ancienne page.
    expect(listSales).not.toHaveBeenCalledWith(
      expect.objectContaining({ paymentMethod: "WAVE", page: 5 }),
    )
  })

  it("answers how many sales and for how much", async () => {
    vi.mocked(listSales).mockResolvedValue({
      count: 2,
      next: null,
      previous: null,
      results: [
        saleFixture("a12f0000-0000-0000-0000-000000000000", { net_total: "1500.00" }),
        saleFixture("b34e0000-0000-0000-0000-000000000000", { net_total: "2000.00" }),
      ],
    })

    renderPage()

    const summary = await screen.findByRole("status", { name: "Résultat de la recherche" })
    expect(summary).toHaveTextContent("2 ventes")
    expect(summary).toHaveTextContent("Total")
    expect(summary).toHaveTextContent("3 500 FCFA")
  })

  it("drops the date from a row when the sale is from today", async () => {
    const todayNoon = new Date()
    todayNoon.setHours(12, 0, 0, 0)
    vi.mocked(listSales).mockResolvedValue({
      count: 1,
      next: null,
      previous: null,
      results: [saleFixture("a12f0000-0000-0000-0000-000000000000", {
        created_at: todayNoon.toISOString(),
      })],
    })

    renderPage()

    const row = await screen.findByRole("link", { name: /Ticket A12F0000/ })
    // La caisse est déjà dans l'en-tête, la date est celle du jour : ni l'une
    // ni l'autre ne distingue une ligne d'une autre.
    expect(row).not.toHaveTextContent("Caisse A")
    expect(row).not.toHaveTextContent(formatDate(todayNoon.toISOString()))
    expect(row).toHaveTextContent("Espèces")
  })

  it("keeps the date on a row when the sale is from another day", async () => {
    const earlier = new Date()
    earlier.setDate(earlier.getDate() - 3)
    earlier.setHours(12, 0, 0, 0)
    vi.mocked(listSales).mockResolvedValue({
      count: 1,
      next: null,
      previous: null,
      results: [saleFixture("a12f0000-0000-0000-0000-000000000000", {
        created_at: earlier.toISOString(),
      })],
    })

    renderPage()

    const row = await screen.findByRole("link", { name: /Ticket A12F0000/ })
    expect(row).toHaveTextContent(formatDate(earlier.toISOString()))
  })
})
