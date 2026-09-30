/**
 * Suggests up to three round cash amounts a cashier could plausibly receive
 * for `total`, all strictly above it (« Montant exact » covers the total
 * itself). Ordered by how often a customer actually hands them over: the
 * next 500, then the next 5 000 / 10 000 note, and the next 1 000 only to
 * fill in — so 4 150 gives 4 500, 5 000, 10 000 rather than four near-equal
 * amounts. No change-making logic.
 */
export function getSuggestedCashAmounts(total: number): number[] {
  if (total <= 0) return []

  const suggestions = new Set<number>()
  for (const step of [500, 5_000, 10_000, 1_000]) {
    const roundedUp = Math.ceil(total / step) * step
    if (roundedUp > total) suggestions.add(roundedUp)
    if (suggestions.size === 3) break
  }

  return [...suggestions].sort((left, right) => left - right)
}
