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

/**
 * Montant saisi, regroupé par milliers au fil de la frappe : « 25000 » se lit
 * « 25 000 », et un zéro de trop saute aux yeux avant la validation. Ne garde
 * que les chiffres — `parseMoneyInput` relit la valeur telle quelle.
 */
export function formatMoneyInput(value: string): string {
  const digits = value.replace(/\D/g, "").replace(/^0+(?=\d)/, "")
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, " ")
}

export function toBackendMoney(amount: number): string {
  return `${amount}.00`
}
