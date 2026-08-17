// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { Product } from "../../types/api"
import { ProductSearch } from "./ProductSearch"

const coca: Product = {
  id: "product-id",
  name: "Coca 50cl",
  barcode: "123456789",
  selling_price: "500.00",
  purchase_price: null,
  is_active: true,
  stock: 18,
  created_at: "2026-08-17T00:00:00Z",
  updated_at: "2026-08-17T00:00:00Z",
}

function renderSearch(onProductSelect = vi.fn()) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <ProductSearch storeId="store-id" onProductSelect={onProductSelect} />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("ProductSearch", () => {
  it("looks up an entered barcode and adds the exact product", async () => {
    const user = userEvent.setup()
    const onProductSelect = vi.fn()
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify([coca]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    )

    renderSearch(onProductSelect)
    const input = screen.getByLabelText("Scanner un code-barres ou rechercher par nom")
    await user.type(input, "123456789{Enter}")

    await waitFor(() => expect(onProductSelect).toHaveBeenCalledWith(coca))
    expect(input).toHaveValue("")
    expect(input).toHaveFocus()
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe(
      "/api/v1/products/?store_id=store-id&barcode=123456789",
    )
  })

  it("shows an explicit empty result", async () => {
    const user = userEvent.setup()
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } }),
    )

    renderSearch()
    await user.type(
      screen.getByLabelText("Scanner un code-barres ou rechercher par nom"),
      "inconnu{Enter}",
    )

    expect(await screen.findByText("Aucun produit trouvé.")).toBeInTheDocument()
  })

  it("passes an available selected product to the cart", async () => {
    const user = userEvent.setup()
    const onProductSelect = vi.fn()
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify([coca]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    )

    renderSearch(onProductSelect)
    await user.type(
      screen.getByLabelText("Scanner un code-barres ou rechercher par nom"),
      "coca",
    )
    await user.click(await screen.findByRole("button", { name: "Ajouter Coca 50cl au panier" }))

    expect(onProductSelect).toHaveBeenCalledWith(coca)
    expect(screen.getByLabelText("Scanner un code-barres ou rechercher par nom")).toHaveValue("")
    expect(screen.getByLabelText("Scanner un code-barres ou rechercher par nom")).toHaveFocus()
    expect(screen.queryByText("Coca 50cl")).not.toBeInTheDocument()
  })

  it("adds the same product again on a repeated scan", async () => {
    const user = userEvent.setup()
    const onProductSelect = vi.fn()
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify([coca]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    )

    renderSearch(onProductSelect)
    const input = screen.getByLabelText("Scanner un code-barres ou rechercher par nom")
    await user.type(input, "123456789{Enter}")
    await waitFor(() => expect(onProductSelect).toHaveBeenCalledTimes(1))
    await user.type(input, "123456789{Enter}")
    await waitFor(() => expect(onProductSelect).toHaveBeenCalledTimes(2))

    expect(input).toHaveValue("")
    expect(input).toHaveFocus()
  })
})
