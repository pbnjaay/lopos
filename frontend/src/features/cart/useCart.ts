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

  function mutateItems(mutator: (items: CartItem[]) => CartItem[]): Promise<void> {
    if (!cashSessionId || !cart) return Promise.resolve()
    const nextItems = mutator(items)
    queryClient.setQueryData(activeCartQueryKey(cashSessionId), { ...cart, items: nextItems })
    return saveActiveCartItems(cashSessionId, nextItems)
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
