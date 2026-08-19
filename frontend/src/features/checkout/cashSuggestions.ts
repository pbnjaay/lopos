const CASH_DENOMINATIONS = [500, 1_000, 2_000, 5_000, 10_000, 20_000]

/**
 * Suggests a handful of round cash amounts a cashier could plausibly
 * receive for `total`, always >= total. Deliberately simple: round up to
 * the nearest 500 (a comfortable "round" amount for any total), plus the
 * common banknote denominations that cover it — no change-making logic.
 */
export function getSuggestedCashAmounts(total: number): number[] {
  if (total <= 0) return []

  const suggestions = new Set<number>()

  const roundedUp = Math.ceil(total / 500) * 500
  if (roundedUp > total) suggestions.add(roundedUp)

  for (const denomination of CASH_DENOMINATIONS) {
    if (denomination >= total) suggestions.add(denomination)
  }

  return [...suggestions].sort((left, right) => left - right).slice(0, 4)
}
