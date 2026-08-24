import type { CatalogProduct } from "../products/types"
import { lineTotal } from "../../utils/quantity"

export type CartItem = {
  productId: string
  name: string
  unitPrice: number
  catalogUnitPrice?: number
  saleUnit?: "UNIT" | "KG"
  quantityMilli?: number
  stockMilli?: number
  quantity?: number
  stock?: number
}

const unit = (item: CartItem) => item.saleUnit ?? "UNIT"
const getQuantityMilli = (item: CartItem) => item.quantityMilli ?? (item.quantity ?? 0) * 1000
const stockMilli = (item: CartItem) => item.stockMilli ?? (item.stock ?? 0) * 1000
const productStockMilli = (product: CatalogProduct) => product.stockMilli ?? (product.stock ?? 0) * 1000

export function addItem(items: CartItem[], product: CatalogProduct, quantityMilli = 1000): CartItem[] {
  const available = productStockMilli(product)
  if (available <= 0 || quantityMilli <= 0) return items

  const existing = items.find((item) => item.productId === product.id)
  if (!existing) {
    const normalizedQuantity = Math.min(quantityMilli, available)
    const item: CartItem = {
      productId: product.id,
      name: product.name,
      unitPrice: product.sellingPrice,
      quantity: normalizedQuantity / 1000,
      stock: available / 1000,
    }
    if (product.saleUnit) {
      item.catalogUnitPrice = product.sellingPrice
      item.saleUnit = product.saleUnit
      item.quantityMilli = normalizedQuantity
      item.stockMilli = available
    }
    return [
      ...items,
      item,
    ]
  }

  if (getQuantityMilli(existing) >= stockMilli(existing)) return items
  return items.map((item) =>
    item.productId === product.id ? (() => { const next = Math.min(getQuantityMilli(item) + quantityMilli, stockMilli(item)); return { ...item, quantityMilli: next, quantity: next / 1000 } })() : item,
  )
}

export function incrementItem(items: CartItem[], productId: string): CartItem[] {
  return items.map((item) =>
    item.productId === productId && getQuantityMilli(item) < stockMilli(item)
      ? (() => { const next = Math.min(getQuantityMilli(item) + (unit(item) === "UNIT" ? 1000 : 100), stockMilli(item)); return { ...item, quantityMilli: next, quantity: next / 1000 } })()
      : item,
  )
}

export function decrementItem(items: CartItem[], productId: string): CartItem[] {
  return items.map((item) =>
    item.productId === productId && getQuantityMilli(item) > (unit(item) === "UNIT" ? 1000 : 100)
      ? (() => { const next = getQuantityMilli(item) - (unit(item) === "UNIT" ? 1000 : 100); return { ...item, quantityMilli: next, quantity: next / 1000 } })()
      : item,
  )
}

export function setItemQuantity(
  items: CartItem[],
  productId: string,
  quantityMilli: number,
): CartItem[] {
  return items.map((item) =>
    item.productId === productId
      ? (() => { const requested = unit(item) === "UNIT" && quantityMilli < 1000 ? quantityMilli * 1000 : quantityMilli; const next = Math.min(Math.max(requested, unit(item) === "UNIT" ? 1000 : 1), stockMilli(item)); return { ...item, quantityMilli: next, quantity: next / 1000 } })()
      : item,
  )
}

export function setItemPrice(items: CartItem[], productId: string, unitPrice: number): CartItem[] {
  if (!Number.isSafeInteger(unitPrice) || unitPrice <= 0) return items
  return items.map((item) => item.productId === productId ? { ...item, unitPrice } : item)
}

export function removeItem(items: CartItem[], productId: string): CartItem[] {
  return items.filter((item) => item.productId !== productId)
}

export function clearCart(): CartItem[] {
  return []
}

export function getCartTotal(items: CartItem[]): number {
  return items.reduce((total, item) => total + lineTotal(item.unitPrice, getQuantityMilli(item)), 0)
}
