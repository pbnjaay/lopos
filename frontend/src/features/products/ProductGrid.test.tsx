// @vitest-environment jsdom

import "fake-indexeddb/auto"
import "@testing-library/jest-dom/vitest"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { Product } from "../../types/api"
import { ProductGrid } from "./ProductGrid"

function product(overrides: Partial<Product> & Pick<Product, "id" | "name">): Product {
  return {
    barcode: null,
    selling_price: "500.00",
    purchase_price: null,
    is_active: true,
    stock: 18,
    created_at: "2026-08-17T00:00:00Z",
    updated_at: "2026-08-17T00:00:00Z",
    ...overrides,
  } as Product
}

function renderGrid(onProductSelect = vi.fn()) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <ProductGrid storeId="store-id" onProductSelect={onProductSelect} />
    </QueryClientProvider>,
  )
}

/** Le composant ne parle qu'a /products/top/ ; on capture l'URL demandee. */
function mockTopProducts(products: Product[]) {
  const urls: string[] = []
  vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
    urls.push(String(input))
    return Promise.resolve(
      new Response(JSON.stringify(products), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    )
  })
  return urls
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("ProductGrid", () => {
  it("demande les meilleures ventes, jamais le catalogue entier", async () => {
    const urls = mockTopProducts([product({ id: "coca", name: "Coca 50cl" })])
    renderGrid()

    await screen.findByRole("button", { name: /Coca 50cl/ })
    expect(urls[0]).toContain("products/top/")
    expect(urls[0]).toContain("limit=18")
  })

  it("affiche le classement recu dans un ordre alphabetique stable", async () => {
    // Le serveur renvoie par volume de ventes ; l'ecran doit reordonner, sinon
    // les tuiles changeraient de place au gre des ventes du jour.
    mockTopProducts([
      product({ id: "riz", name: "Riz brisé 1kg" }),
      product({ id: "banane", name: "Banane" }),
      product({ id: "coca", name: "Coca 50cl" }),
    ])
    renderGrid()

    await waitFor(() => expect(screen.getAllByRole("button")).toHaveLength(3))
    const names = screen.getAllByRole("button").map((tile) => tile.textContent)
    expect(names[0]).toContain("Banane")
    expect(names[1]).toContain("Coca 50cl")
    expect(names[2]).toContain("Riz brisé 1kg")
  })

  it("ajoute le produit touche", async () => {
    const user = userEvent.setup()
    const onProductSelect = vi.fn()
    mockTopProducts([product({ id: "coca", name: "Coca 50cl" })])
    renderGrid(onProductSelect)

    await user.click(await screen.findByRole("button", { name: /Ajouter Coca 50cl au panier/ }))

    expect(onProductSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: "coca", name: "Coca 50cl" }),
    )
  })

  it("remplace le prix par « Rupture » et empeche la vente", async () => {
    const user = userEvent.setup()
    const onProductSelect = vi.fn()
    mockTopProducts([product({ id: "lait", name: "Lait en poudre 400g", stock: 0 })])
    renderGrid(onProductSelect)

    const tile = await screen.findByRole("button", {
      name: /Lait en poudre 400g en rupture de stock/,
    })
    expect(tile).toBeDisabled()
    // Le prix disparait : un article non vendable n'a pas de prix a afficher,
    // et c'est ce qui garde toutes les tuiles a la meme hauteur.
    expect(tile).toHaveTextContent("Rupture")
    expect(tile).not.toHaveTextContent("500")

    await user.click(tile)
    expect(onProductSelect).not.toHaveBeenCalled()
  })

  it("reste silencieux quand le classement echoue : la recherche et le scanner marchent encore", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("réseau"))
    renderGrid()

    await waitFor(() => expect(screen.queryAllByRole("button")).toHaveLength(0))
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })
})
