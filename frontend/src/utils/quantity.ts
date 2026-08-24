export const QUANTITY_SCALE = 1000

export function parseQuantityToMilli(value: string): number | null {
  const normalized = value.trim().replace(",", ".")
  if (!/^\d+(?:\.\d{0,3})?$/.test(normalized)) return null
  const [whole, fraction = ""] = normalized.split(".")
  const result = Number(whole) * QUANTITY_SCALE + Number(fraction.padEnd(3, "0"))
  return Number.isSafeInteger(result) && result > 0 ? result : null
}

export function backendQuantityToMilli(value: string | number): number {
  if (typeof value === "number") return value * QUANTITY_SCALE
  if (/^0(?:\.0{1,3})?$/.test(value)) return 0
  const result = parseQuantityToMilli(value)
  if (result === null) throw new Error(`Quantité invalide : ${value}`)
  return result
}

export function milliToBackendQuantity(value: number): string {
  const whole = Math.floor(value / QUANTITY_SCALE)
  const fraction = String(value % QUANTITY_SCALE).padStart(3, "0")
  return `${whole}.${fraction}`
}

export function formatQuantity(value: number, saleUnit: "UNIT" | "KG"): string {
  if (saleUnit === "UNIT") return String(value / QUANTITY_SCALE)
  return `${milliToBackendQuantity(value).replace(".", ",")} kg`
}

export function lineTotal(unitPrice: number, quantityMilli: number): number {
  const result = (BigInt(unitPrice) * BigInt(quantityMilli) + 500n) / 1000n
  const amount = Number(result)
  if (!Number.isSafeInteger(amount)) throw new Error("Total de ligne hors limites.")
  return amount
}
