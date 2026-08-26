import { formatBackendMoney, formatMoney } from "../../utils/money"

type MoneyProps = {
  /** Montant entier en FCFA (représentation front). */
  value?: number
  /** Montant décimal renvoyé par l'API ("2500.00"). */
  backend?: string
  /** Préfixe de signe pour un remboursement ou un retour. */
  sign?: "minus"
  className?: string
}

/**
 * Rendu unique des montants : `2 500 FCFA`, chiffres à chasse fixe pour que
 * les colonnes s'alignent sans changer de police.
 */
export function Money({ value, backend, sign, className = "" }: MoneyProps) {
  const formatted = backend !== undefined ? formatBackendMoney(backend) : formatMoney(value ?? 0)
  return (
    <span className={`money ${className}`.trim()}>
      {sign === "minus" ? "− " : ""}
      {formatted}
    </span>
  )
}
