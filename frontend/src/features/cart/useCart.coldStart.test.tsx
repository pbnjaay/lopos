// @vitest-environment jsdom

import "fake-indexeddb/auto"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import type { PropsWithChildren } from "react"
import { afterEach, describe, expect, it } from "vitest"

import { db } from "../../db/database"
import type { CatalogProduct } from "../products/types"
import { useCart } from "./useCart"

const coca: CatalogProduct = {
  id: "coca",
  name: "Coca 50cl",
  barcode: null,
  sellingPrice: 500,
  isActive: true,
  stock: 20,
}

function wrapper({ children }: PropsWithChildren) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, networkMode: "always" } },
  })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

afterEach(async () => {
  cleanup()
  localStorage.clear()
  await db.carts.clear()
})

/**
 * Fichier séparé : ce scénario laisse volontairement une lecture du panier
 * actif en vol, ce qui perturberait les tests voisins s'ils partageaient le
 * même Dexie de fichier.
 */
describe("useCart au démarrage à froid", () => {
  // Un scanner émet son code dès l'affichage du POS, avant que la lecture
  // Dexie du panier actif n'ait répondu. L'article était alors perdu en
  // silence : le champ de recherche se vidait, le panier restait vide.
  it("garde un article scanné avant que le panier actif ne soit résolu", async () => {
    const { result } = renderHook(() => useCart("session-cold", "store-a"), { wrapper })

    // Volontairement sans attendre la fin du chargement.
    await act(async () => {
      await result.current.addItem(coca)
    })

    await waitFor(() =>
      expect(result.current.items).toMatchObject([{ productId: "coca", quantity: 1 }]),
    )
    const stored = await db.carts.where("cashSessionId").equals("session-cold").first()
    expect(stored?.items).toMatchObject([{ productId: "coca", quantity: 1 }])
  })
})
