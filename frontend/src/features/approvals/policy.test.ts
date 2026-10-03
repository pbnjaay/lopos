import { describe, expect, it } from "vitest"

import { ApiError } from "../../api/client"
import type { ApprovalPolicy } from "../../types/api"
import { approvalPolicyFor, discountNeedsApproval, isApprovalRequiredError } from "./policy"

const policy: ApprovalPolicy = {
  required: true,
  amount_threshold: "5000.00",
  max_discount_rate: "0.10",
  return_window_days: 7,
}

const line = (catalogUnitPrice: number, unitPrice: number, quantityMilli = 1000) => ({
  catalogUnitPrice,
  unitPrice,
  quantityMilli,
})

describe("discountNeedsApproval", () => {
  it("lets a cashier give up to 10 % on a line", () => {
    expect(discountNeedsApproval([line(1000, 900)], policy)).toBe(false)
    expect(discountNeedsApproval([line(1000, 899)], policy)).toBe(true)
  })

  it("adds up small discounts until the amount threshold", () => {
    expect(discountNeedsApproval([line(1000, 950, 99_000)], policy)).toBe(false)
    expect(discountNeedsApproval([line(1000, 950, 100_000)], policy)).toBe(true)
  })

  it("never treats a price increase as a discount", () => {
    expect(discountNeedsApproval([line(1000, 5000, 10_000)], policy)).toBe(false)
  })

  it("never asks a manager or an owner", () => {
    expect(discountNeedsApproval([line(1000, 1)], { ...policy, required: false })).toBe(false)
  })
})

describe("approvalPolicyFor", () => {
  it("falls back to the cashier thresholds for an account remembered before the policy existed", () => {
    expect(approvalPolicyFor({ role: "CASHIER" }).required).toBe(true)
    expect(approvalPolicyFor({ role: "MANAGER" }).required).toBe(false)
  })
})

describe("isApprovalRequiredError", () => {
  it("recognises the server's approval refusal only", () => {
    expect(isApprovalRequiredError(new ApiError(403, { code: "MANAGER_APPROVAL_REQUIRED" }))).toBe(true)
    expect(isApprovalRequiredError(new ApiError(403, { code: "CASH_SESSION_NOT_OWNED" }))).toBe(false)
    expect(isApprovalRequiredError(new Error("x"))).toBe(false)
  })
})
