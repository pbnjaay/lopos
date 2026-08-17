// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"

import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { MobileMoneyConfirmation } from "./MobileMoneyConfirmation"

afterEach(cleanup)

describe("MobileMoneyConfirmation", () => {
  it("requires explicit cashier confirmation for Wave", async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(
      <MobileMoneyConfirmation
        method="WAVE"
        total={1_000}
        isSubmitting={false}
        onClose={vi.fn()}
        onBack={vi.fn()}
        onConfirm={onConfirm}
      />,
    )

    expect(screen.getByText(/Vérifiez sa réception sur le téléphone/)).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Paiement reçu" }))
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it("labels an Orange Money confirmation and locks it while submitting", () => {
    render(
      <MobileMoneyConfirmation
        method="ORANGE_MONEY"
        total={8_500}
        isSubmitting
        onClose={vi.fn()}
        onBack={vi.fn()}
        onConfirm={vi.fn()}
      />,
    )

    expect(screen.getByRole("heading", { name: "Paiement Orange Money" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Validation…" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Annuler" })).toBeDisabled()
  })

  it("returns to the payment methods without cancelling checkout", async () => {
    const user = userEvent.setup()
    const onBack = vi.fn()
    render(
      <MobileMoneyConfirmation
        method="WAVE"
        total={1_000}
        isSubmitting={false}
        onClose={vi.fn()}
        onBack={onBack}
        onConfirm={vi.fn()}
      />,
    )

    await user.click(screen.getByRole("button", { name: /Changer de moyen de paiement/ }))
    expect(onBack).toHaveBeenCalledOnce()
  })
})
