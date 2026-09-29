// @vitest-environment jsdom

import "fake-indexeddb/auto"
import "@testing-library/jest-dom/vitest"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { saveCustomerBook } from "../../db/customers"
import { db } from "../../db/database"
import type { Customer } from "../../types/api"
import { CustomerPicker } from "./CustomerPicker"

const moussa: Customer = {
  id: "moussa",
  store_id: "store-id",
  name: "Moussa Fall",
  phone: "+221771234567",
  is_active: true,
  balance: "18500.00",
  last_activity_at: "2026-09-27T10:00:00Z",
  updated_at: "2026-09-01T00:00:00Z",
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function renderPicker({ isOnline = true, onSelect = vi.fn() } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <CustomerPicker storeId="store-id" isOnline={isOnline} onSelect={onSelect} onClose={vi.fn()} />
    </QueryClientProvider>,
  )
  return { onSelect }
}

afterEach(async () => {
  cleanup()
  vi.restoreAllMocks()
  await db.customers.clear()
  await db.metadata.clear()
})

describe("CustomerPicker", () => {
  it("finds a cached customer by phone digits and selects it with Enter", async () => {
    await saveCustomerBook("store-id", [moussa])
    const fetchMock = vi.spyOn(globalThis, "fetch")
    const user = userEvent.setup()
    const { onSelect } = renderPicker()

    await user.type(screen.getByLabelText("Téléphone ou nom du client"), "4567")

    const result = await screen.findByRole("button", { name: "Choisir Moussa Fall" })
    expect(result).toHaveTextContent("77 123 45 67")
    expect(result).toHaveTextContent("18 500 FCFA")
    await user.keyboard("{Enter}")

    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: "moussa", name: "Moussa Fall", balance: 18_500 }),
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("downloads the book once when the terminal has none yet", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse([moussa]))
    const user = userEvent.setup()
    renderPicker()

    await user.type(screen.getByLabelText("Téléphone ou nom du client"), "moussa")

    expect(await screen.findByRole("button", { name: "Choisir Moussa Fall" })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]![0])).toContain("customers/?store_id=store-id")
  })

  it("creates a customer from what was typed and selects it", async () => {
    await saveCustomerBook("store-id", [moussa])
    const created: Customer = { ...moussa, id: "awa", name: "Awa Diop", phone: "+221760001122", balance: "0.00" }
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(created, 201))
    const user = userEvent.setup()
    const { onSelect } = renderPicker()

    await user.type(screen.getByLabelText("Téléphone ou nom du client"), "Awa Diop")
    await screen.findByText("Aucun client trouvé.")
    await user.click(screen.getByRole("button", { name: "+ Nouveau client" }))

    expect(screen.getByLabelText("Nom")).toHaveValue("Awa Diop")
    await user.type(screen.getByLabelText("Téléphone"), "76 000 11 22")
    await user.click(screen.getByRole("button", { name: "Créer le client" }))

    await waitFor(() =>
      expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "awa", balance: 0 })),
    )
    const [, init] = fetchMock.mock.calls[0]!
    expect(JSON.parse(String(init?.body))).toEqual({
      store_id: "store-id",
      name: "Awa Diop",
      phone: "+221760001122",
    })
    expect(await db.customers.get(["store-id", "awa"])).toBeDefined()
  })

  it("offers the existing customer when the phone is already known", async () => {
    await saveCustomerBook("store-id", [])
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(
        { code: "CUSTOMER_DUPLICATE", message: "Un client existe déjà.", customer: moussa },
        409,
      ),
    )
    const user = userEvent.setup()
    const { onSelect } = renderPicker()

    await user.type(screen.getByLabelText("Téléphone ou nom du client"), "771234567")
    await screen.findByText("Aucun client trouvé.")
    await user.click(screen.getByRole("button", { name: "+ Nouveau client" }))
    expect(screen.getByLabelText("Téléphone")).toHaveValue("771234567")
    await user.type(screen.getByLabelText("Nom"), "Moussa")
    await user.click(screen.getByRole("button", { name: "Créer le client" }))

    expect(await screen.findByText("Client déjà enregistré")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Choisir Moussa Fall" }))
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "moussa" }))
  })

  it("validates the phone before calling the server", async () => {
    await saveCustomerBook("store-id", [])
    const fetchMock = vi.spyOn(globalThis, "fetch")
    const user = userEvent.setup()
    renderPicker()

    await user.click(screen.getByRole("button", { name: "+ Nouveau client" }))
    await user.type(screen.getByLabelText("Nom"), "Awa")
    await user.type(screen.getByLabelText("Téléphone"), "12")
    await user.click(screen.getByRole("button", { name: "Créer le client" }))

    expect(await screen.findByText(/Numéro de téléphone invalide/)).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("does not offer creation offline", async () => {
    await saveCustomerBook("store-id", [moussa])
    renderPicker({ isOnline: false })

    expect(screen.getByRole("button", { name: "+ Nouveau client" })).toBeDisabled()
  })
})
