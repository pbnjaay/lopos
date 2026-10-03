import { ApiError } from "../../api/client"
import type { ApprovalPolicy, CurrentUser } from "../../types/api"

/**
 * Politique par défaut d'un caissier dont le compte a été mémorisé avant
 * que le serveur ne l'envoie : mêmes seuils que le serveur, qui reste seul
 * juge (il refait chaque contrôle).
 */
const CASHIER_DEFAULT_POLICY: ApprovalPolicy = {
  required: true,
  amount_threshold: "5000.00",
  max_discount_rate: "0.10",
  return_window_days: 7,
}

export function approvalPolicyFor(user: Pick<CurrentUser, "role" | "approval_policy">): ApprovalPolicy {
  if (user.approval_policy) return user.approval_policy
  return user.role === "CASHIER"
    ? CASHIER_DEFAULT_POLICY
    : { ...CASHIER_DEFAULT_POLICY, required: false }
}

/** Le serveur demande la validation d'un gérant pour cette opération. */
export function isApprovalRequiredError(error: unknown): boolean {
  return error instanceof ApiError && error.code === "MANAGER_APPROVAL_REQUIRED"
}

export type DiscountLine = {
  /** Prix catalogue, en FCFA entiers. */
  catalogUnitPrice: number
  /** Prix pratiqué, en FCFA entiers. */
  unitPrice: number
  /** Quantité en millièmes (1 000 = une unité ou un kg). */
  quantityMilli: number
}

/**
 * Même règle que le serveur (`approvals.discount_needs_approval`) : une
 * ligne remisée au-delà du taux, ou une remise totale atteignant le seuil.
 * Une hausse de prix n'est pas une remise.
 */
export function discountNeedsApproval(lines: DiscountLine[], policy: ApprovalPolicy): boolean {
  if (!policy.required) return false
  const maxRate = Number(policy.max_discount_rate)
  const threshold = Number(policy.amount_threshold)
  let totalDiscount = 0
  for (const line of lines) {
    if (!line.catalogUnitPrice || line.unitPrice >= line.catalogUnitPrice) continue
    const rate = (line.catalogUnitPrice - line.unitPrice) / line.catalogUnitPrice
    if (rate > maxRate) return true
    totalDiscount += ((line.catalogUnitPrice - line.unitPrice) * line.quantityMilli) / 1000
  }
  return totalDiscount >= threshold
}

/** Remise au-delà de la limite du caissier, sans connexion pour la faire valider. */
export class DiscountNeedsConnectionError extends Error {
  constructor() {
    super(
      "Cette remise dépasse ce qu’un caissier accorde seul et doit être validée par un gérant, ce qui demande une connexion. Revenez au prix catalogue ou attendez le retour du réseau.",
    )
    this.name = "DiscountNeedsConnectionError"
  }
}

/** Le gérant n'a pas validé la remise (dialogue fermé). */
export class DiscountNotApprovedError extends Error {
  constructor() {
    super("Remise non validée : la vente n’a pas été enregistrée.")
    this.name = "DiscountNotApprovedError"
  }
}
