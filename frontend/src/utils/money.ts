const integerFormatter = new Intl.NumberFormat("fr-FR", {
  maximumFractionDigits: 0,
})

export function formatMoney(amount: number): string {
  const formatted = integerFormatter.format(amount).replaceAll("\u202f", " ")
  return `${formatted} FCFA`
}

export function formatBackendMoney(amount: string): string {
  return formatMoney(Number(amount))
}

export type CashDifferenceDescription = {
  label: string
  kind: "shortage" | "surplus" | "balanced"
}

export function describeCashDifference(amount: string): CashDifferenceDescription {
  const difference = Number(amount)
  if (difference < 0) {
    return { label: `Manque : ${formatMoney(Math.abs(difference))}`, kind: "shortage" }
  }
  if (difference > 0) {
    return { label: `Surplus : ${formatMoney(difference)}`, kind: "surplus" }
  }
  return { label: "Aucun écart", kind: "balanced" }
}

export function parseMoneyInput(value: string): number | null {
  const normalized = value.replaceAll(/\s/g, "")
  if (!/^\d+$/.test(normalized)) return null

  const amount = Number(normalized)
  if (!Number.isSafeInteger(amount) || amount > 999_999_999_999) return null
  return amount
}

export function toBackendMoney(amount: number): string {
  return `${amount}.00`
}
