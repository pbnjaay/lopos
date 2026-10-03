import type { ApprovalAction, Approver } from "../types/api"
import { apiRequest, buildApiUrl } from "./client"

/** Gérants du magasin et propriétaire pouvant valider sur ce poste. */
export function listApprovers(cashSessionId: string): Promise<Approver[]> {
  return apiRequest<Approver[]>(
    buildApiUrl("approvals/approvers/", { cash_session_id: cashSessionId }),
  )
}

/**
 * Le gérant tape son PIN sur le poste : le serveur rend une validation
 * signée, valable quelques minutes pour cette opération sur cette vente.
 */
export function requestApproval(input: {
  cashSessionId: string
  action: ApprovalAction
  saleId: string
  approverId: number
  pin: string
}): Promise<{ approval_token: string; approver: Approver }> {
  return apiRequest("approvals/", {
    method: "POST",
    body: {
      cash_session_id: input.cashSessionId,
      action: input.action,
      sale_id: input.saleId,
      approver_id: input.approverId,
      pin: input.pin,
    },
  })
}
