import { useQuery, useQueryClient } from "@tanstack/react-query"

import {
  ensureActiveCart,
  deleteHeldCart as deleteHeldCartRow,
  holdActiveCart,
  listHeldCarts,
  resumeHeldCart,
  saveActiveCartItems,
} from "../../db/carts"
import type { CatalogProduct } from "../products/types"
import { revalidateCartItems, type CartRevalidationResult } from "./cartRevalidation"
import {
  type CartItem,
  addItem,
  clearCart,
  decrementItem,
  getCartTotal,
  incrementItem,
  removeItem,
  setItemQuantity,
  setItemPrice,
} from "./cartState"

function activeCartQueryKey(cashSessionId: string | null) {
  return ["active-cart", cashSessionId] as const
}

function heldCartsQueryKey(cashSessionId: string | null) {
  return ["held-carts", cashSessionId] as const
}

export function useCart(cashSessionId: string | null = null, storeId: string | null = null) {
  const queryClient = useQueryClient()

  const activeCartQuery = useQuery({
    queryKey: activeCartQueryKey(cashSessionId),
    queryFn: () => ensureActiveCart(cashSessionId!),
    enabled: cashSessionId !== null,
  })
  const heldCartsQuery = useQuery({
    queryKey: heldCartsQueryKey(cashSessionId),
    queryFn: () => listHeldCarts(cashSessionId!),
    enabled: cashSessionId !== null,
  })

  const cart = activeCartQuery.data ?? null
  const items = (cart?.items as CartItem[] | undefined) ?? []

  /**
   * Chemin normal : mise à jour optimiste immédiate, puis écriture Dexie.
   * C'est ce qui rend le scan instantané, il ne doit rien attendre.
   *
   * Chemin froid : au tout premier instant du POS, le scanner peut émettre
   * son code avant que la lecture du panier actif n'ait répondu. Abandonner
   * la mutation perdait l'article en silence — le champ se vidait, rien
   * n'entrait dans le panier. On écrit alors dans Dexie d'abord, puis on
   * relit : une lecture encore en vol ne peut plus réécrire un panier vide
   * par-dessus l'ajout, puisque la relecture part de la source de vérité.
   */
  function mutateItems(mutator: (items: CartItem[]) => CartItem[]): Promise<void> {
    if (!cashSessionId) return Promise.resolve()
    const queryKey = activeCartQueryKey(cashSessionId)

    if (cart) {
      const nextItems = mutator(items)
      queryClient.setQueryData(queryKey, { ...cart, items: nextItems })
      return saveActiveCartItems(cashSessionId, nextItems)
    }

    return (async () => {
      const activeCart = await ensureActiveCart(cashSessionId)
      const nextItems = mutator((activeCart.items as CartItem[] | undefined) ?? [])
      await saveActiveCartItems(cashSessionId, nextItems)
      await queryClient.invalidateQueries({ queryKey })
    })()
  }

  async function holdCart(): Promise<void> {
    if (!cashSessionId || items.length === 0) return
    await holdActiveCart(cashSessionId)
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: activeCartQueryKey(cashSessionId) }),
      queryClient.invalidateQueries({ queryKey: heldCartsQueryKey(cashSessionId) }),
    ])
  }

  /**
   * Resumes a held cart into the (already emptied) active cart. Always
   * revalidates against the live local catalog first — a held cart can be
   * hours old, so its snapshot is never trusted as-is.
   */
  async function resumeCart(cartId: string): Promise<CartRevalidationResult | null> {
    if (!cashSessionId || !storeId) return null
    const held = heldCartsQuery.data?.find((candidate) => candidate.id === cartId)
    if (!held) return null

    const revalidation = await revalidateCartItems(held.items as CartItem[], storeId)
    await resumeHeldCart(cartId, cashSessionId, revalidation.items)
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: activeCartQueryKey(cashSessionId) }),
      queryClient.invalidateQueries({ queryKey: heldCartsQueryKey(cashSessionId) }),
    ])
    return revalidation
  }

  async function deleteHeldCart(cartId: string): Promise<void> {
    if (!cashSessionId) return
    await deleteHeldCartRow(cartId, cashSessionId)
    await queryClient.invalidateQueries({ queryKey: heldCartsQueryKey(cashSessionId) })
  }

  return {
    items,
    total: getCartTotal(items),
    isLoading: activeCartQuery.isLoading,
    addItem: (product: CatalogProduct, quantityMilli?: number) =>
      mutateItems((current) => addItem(current, product, quantityMilli)),
    incrementItem: (productId: string) => mutateItems((current) => incrementItem(current, productId)),
    decrementItem: (productId: string) => mutateItems((current) => decrementItem(current, productId)),
    setItemQuantity: (productId: string, quantityMilli: number) =>
      mutateItems((current) => setItemQuantity(current, productId, quantityMilli)),
    setItemPrice: (productId: string, unitPrice: number) =>
      mutateItems((current) => setItemPrice(current, productId, unitPrice)),
    removeItem: (productId: string) => mutateItems((current) => removeItem(current, productId)),
    clearCart: () => mutateItems(() => clearCart()),
    holdCart,
    heldCarts: {
      list: heldCartsQuery.data ?? [],
      count: heldCartsQuery.data?.length ?? 0,
      isLoading: heldCartsQuery.isLoading,
    },
    resumeCart,
    deleteHeldCart,
  }
}
