import { useEffect, useRef, useState } from "react"

import type { CatalogProduct } from "../products/types"
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
import { loadCartForSession, saveCartForSession } from "./cartStorage"

export function useCart(cashSessionId: string | null = null) {
  const [items, setItems] = useState<CartItem[]>(() => loadCartForSession(cashSessionId))
  const restoredSessionId = useRef(cashSessionId)

  useEffect(() => {
    if (restoredSessionId.current === cashSessionId) return
    restoredSessionId.current = cashSessionId
    setItems(loadCartForSession(cashSessionId))
  }, [cashSessionId])

  useEffect(() => {
    saveCartForSession(cashSessionId, items)
  }, [cashSessionId, items])

  return {
    items,
    total: getCartTotal(items),
    addItem: (product: CatalogProduct, quantityMilli?: number) => setItems((current) => addItem(current, product, quantityMilli)),
    incrementItem: (productId: string) =>
      setItems((current) => incrementItem(current, productId)),
    decrementItem: (productId: string) =>
      setItems((current) => decrementItem(current, productId)),
    setItemQuantity: (productId: string, quantityMilli: number) =>
      setItems((current) => setItemQuantity(current, productId, quantityMilli)),
    setItemPrice: (productId: string, unitPrice: number) =>
      setItems((current) => setItemPrice(current, productId, unitPrice)),
    removeItem: (productId: string) =>
      setItems((current) => removeItem(current, productId)),
    clearCart: () => setItems(clearCart()),
  }
}
