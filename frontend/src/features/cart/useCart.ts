import { useState } from "react"

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
} from "./cartState"

export function useCart() {
  const [items, setItems] = useState<CartItem[]>([])

  return {
    items,
    total: getCartTotal(items),
    addItem: (product: CatalogProduct) => setItems((current) => addItem(current, product)),
    incrementItem: (productId: string) =>
      setItems((current) => incrementItem(current, productId)),
    decrementItem: (productId: string) =>
      setItems((current) => decrementItem(current, productId)),
    setItemQuantity: (productId: string, quantity: number) =>
      setItems((current) => setItemQuantity(current, productId, quantity)),
    removeItem: (productId: string) =>
      setItems((current) => removeItem(current, productId)),
    clearCart: () => setItems(clearCart()),
  }
}
