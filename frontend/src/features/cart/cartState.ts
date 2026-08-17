import type { Product } from "../../types/api"

export type CartItem = {
  productId: string
  name: string
  unitPrice: number
  quantity: number
  stock: number
}

export function addItem(items: CartItem[], product: Product): CartItem[] {
  if (product.stock <= 0) return items

  const existing = items.find((item) => item.productId === product.id)
  if (!existing) {
    return [
      ...items,
      {
        productId: product.id,
        name: product.name,
        unitPrice: Math.round(Number(product.selling_price)),
        quantity: 1,
        stock: product.stock,
      },
    ]
  }

  if (existing.quantity >= existing.stock) return items
  return items.map((item) =>
    item.productId === product.id ? { ...item, quantity: item.quantity + 1 } : item,
  )
}

export function incrementItem(items: CartItem[], productId: string): CartItem[] {
  return items.map((item) =>
    item.productId === productId && item.quantity < item.stock
      ? { ...item, quantity: item.quantity + 1 }
      : item,
  )
}

export function decrementItem(items: CartItem[], productId: string): CartItem[] {
  return items.map((item) =>
    item.productId === productId && item.quantity > 1
      ? { ...item, quantity: item.quantity - 1 }
      : item,
  )
}

export function setItemQuantity(
  items: CartItem[],
  productId: string,
  quantity: number,
): CartItem[] {
  if (!Number.isInteger(quantity)) return items

  return items.map((item) =>
    item.productId === productId
      ? { ...item, quantity: Math.min(Math.max(quantity, 1), item.stock) }
      : item,
  )
}

export function removeItem(items: CartItem[], productId: string): CartItem[] {
  return items.filter((item) => item.productId !== productId)
}

export function clearCart(): CartItem[] {
  return []
}

export function getCartTotal(items: CartItem[]): number {
  return items.reduce((total, item) => total + item.unitPrice * item.quantity, 0)
}
