// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"

import { cleanup, fireEvent, render, screen } from "@testing-library/react"
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

  it("confirms the payment with Enter, exactly once", () => {
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

    fireEvent.keyDown(window, { key: "Enter" })
    fireEvent.keyDown(window, { key: "Enter" })

    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it("does not confirm just from selecting the method (no Enter/click yet)", () => {
    const onConfirm = vi.fn()
    render(
      <MobileMoneyConfirmation
        method="ORANGE_MONEY"
        total={1_000}
        isSubmitting={false}
        onClose={vi.fn()}
        onBack={vi.fn()}
        onConfirm={onConfirm}
      />,
    )

    expect(onConfirm).not.toHaveBeenCalled()
  })

  it("returns to payment methods on Escape rather than closing outright", () => {
    const onClose = vi.fn()
    const onBack = vi.fn()
    render(
      <MobileMoneyConfirmation
        method="WAVE"
        total={1_000}
        isSubmitting={false}
        onClose={onClose}
        onBack={onBack}
        onConfirm={vi.fn()}
      />,
    )

    fireEvent.keyDown(window, { key: "Escape" })
    expect(onBack).toHaveBeenCalledOnce()
    expect(onClose).not.toHaveBeenCalled()
  })

  it("confirms with the full amount pre-filled, no typing required", async () => {
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

    await user.click(screen.getByRole("button", { name: "Paiement reçu" }))
    expect(onConfirm).toHaveBeenCalledWith(1_000)
  })

  it("accepts a partial amount for a mixed payment, labelling the action accordingly", async () => {
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

    const amountField = screen.getByLabelText("Montant reçu")
    await user.clear(amountField)
    await user.type(amountField, "400")

    const continueButton = screen.getByRole("button", { name: "Continuer avec un autre moyen" })
    await user.click(continueButton)
    expect(onConfirm).toHaveBeenCalledWith(400)
  })

  it("refuses an amount exceeding what's due — a mobile payment can't give change", async () => {
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

    const amountField = screen.getByLabelText("Montant reçu")
    await user.clear(amountField)
    await user.type(amountField, "1500")

    expect(screen.getByRole("alert")).toHaveTextContent("ne peut pas dépasser")
    expect(screen.getByRole("button", { name: "Paiement reçu" })).toBeDisabled()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it("labels the total \"Reste à payer\" once a first payment has already been applied", () => {
    render(
      <MobileMoneyConfirmation
        method="WAVE"
        total={400}
        isPartial
        isSubmitting={false}
        onClose={vi.fn()}
        onBack={vi.fn()}
        onConfirm={vi.fn()}
      />,
    )

    expect(screen.getByText("Reste à payer").parentElement).toHaveTextContent("400 FCFA")
  })

  it("ignores a held-down Enter key repeat", () => {
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

    fireEvent.keyDown(window, { key: "Enter", repeat: true })
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
