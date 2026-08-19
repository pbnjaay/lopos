// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { CashPaymentModal } from "./CashPaymentModal"

afterEach(cleanup)

describe("CashPaymentModal", () => {
  it("calculates change and confirms a sufficient cash amount", async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(<CashPaymentModal total={1_000} onClose={vi.fn()} onConfirm={onConfirm} />)

    const confirmButton = screen.getByRole("button", { name: "Valider" })
    expect(confirmButton).toBeDisabled()
    await user.type(screen.getByLabelText("Montant reçu"), "2000")

    const changePreview = screen.getByText("Monnaie à rendre").parentElement!
    expect(within(changePreview).getByText("1 000 FCFA")).toBeInTheDocument()
    expect(confirmButton).toBeEnabled()
    await user.click(confirmButton)
    expect(onConfirm).toHaveBeenCalledWith(2_000)
  })

  it("keeps validation disabled when the received amount is insufficient", async () => {
    const user = userEvent.setup()
    render(<CashPaymentModal total={1_000} onClose={vi.fn()} onConfirm={vi.fn()} />)

    await user.type(screen.getByLabelText("Montant reçu"), "500")

    expect(screen.getByRole("button", { name: "Valider" })).toBeDisabled()
    expect(screen.getByRole("alert")).toHaveTextContent("Reste à recevoir500 FCFA")
  })

  it("shows the full total as owed before anything has been typed", () => {
    render(<CashPaymentModal total={1_000} onClose={vi.fn()} onConfirm={vi.fn()} />)

    expect(screen.getByText("Reste à recevoir").parentElement).toHaveTextContent("1 000 FCFA")
  })

  it("submits with Enter once the amount is sufficient, and only once", async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(<CashPaymentModal total={1_000} onClose={vi.fn()} onConfirm={onConfirm} />)

    await user.type(screen.getByLabelText("Montant reçu"), "2000{Enter}")

    expect(onConfirm).toHaveBeenCalledOnce()
    expect(onConfirm).toHaveBeenCalledWith(2_000)
  })

  it("does not submit with Enter while the amount is insufficient", async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(<CashPaymentModal total={1_000} onClose={vi.fn()} onConfirm={onConfirm} />)

    await user.type(screen.getByLabelText("Montant reçu"), "500{Enter}")

    expect(onConfirm).not.toHaveBeenCalled()
  })

  it("keeps Enter submitting after using the on-screen keypad (focus stays on the field)", async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(<CashPaymentModal total={1_000} onClose={vi.fn()} onConfirm={onConfirm} />)

    await user.click(screen.getByRole("button", { name: "Chiffre 2" }))
    await user.click(screen.getByRole("button", { name: "Chiffre 0" }))
    await user.click(screen.getByRole("button", { name: "Chiffre 0" }))
    await user.click(screen.getByRole("button", { name: "Chiffre 0" }))
    expect(screen.getByLabelText("Montant reçu")).toHaveFocus()

    await user.keyboard("{Enter}")

    expect(onConfirm).toHaveBeenCalledOnce()
    expect(onConfirm).toHaveBeenCalledWith(2_000)
  })

  it("closes with Escape when there is nothing to go back to", () => {
    const onClose = vi.fn()
    render(<CashPaymentModal total={1_000} onClose={onClose} onConfirm={vi.fn()} />)

    fireEvent.keyDown(window, { key: "Escape" })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it("returns to payment methods on Escape instead of closing outright", () => {
    const onClose = vi.fn()
    const onBack = vi.fn()
    render(
      <CashPaymentModal total={1_000} onClose={onClose} onBack={onBack} onConfirm={vi.fn()} />,
    )

    fireEvent.keyDown(window, { key: "Escape" })
    expect(onBack).toHaveBeenCalledOnce()
    expect(onClose).not.toHaveBeenCalled()
  })

  it("ignores a held-down Escape key repeat", () => {
    const onClose = vi.fn()
    render(<CashPaymentModal total={1_000} onClose={onClose} onConfirm={vi.fn()} />)

    fireEvent.keyDown(window, { key: "Escape", repeat: true })
    expect(onClose).not.toHaveBeenCalled()
  })

  it("prevents two submissions while the first confirmation is pending", async () => {
    const user = userEvent.setup()
    let resolveConfirmation: (() => void) | undefined
    const confirmation = new Promise<void>((resolve) => {
      resolveConfirmation = resolve
    })
    const onConfirm = vi.fn(() => confirmation)
    render(<CashPaymentModal total={1_000} onClose={vi.fn()} onConfirm={onConfirm} />)
    await user.type(screen.getByLabelText("Montant reçu"), "2000")
    const confirmButton = screen.getByRole("button", { name: "Valider" })

    await user.dblClick(confirmButton)
    expect(onConfirm).toHaveBeenCalledOnce()
    resolveConfirmation?.()
    await confirmation
  })

  it("builds the received amount from the on-screen keypad", async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(<CashPaymentModal total={1_000} onClose={vi.fn()} onConfirm={onConfirm} />)

    await user.click(screen.getByRole("button", { name: "Chiffre 2" }))
    await user.click(screen.getByRole("button", { name: "Chiffre 0" }))
    await user.click(screen.getByRole("button", { name: "Chiffre 0" }))
    await user.click(screen.getByRole("button", { name: "Chiffre 0" }))
    expect(screen.getByLabelText("Montant reçu")).toHaveValue("2000")

    await user.click(screen.getByRole("button", { name: "Supprimer le dernier chiffre" }))
    expect(screen.getByLabelText("Montant reçu")).toHaveValue("200")

    await user.click(screen.getByRole("button", { name: "Effacer le montant" }))
    expect(screen.getByLabelText("Montant reçu")).toHaveValue("")
  })

  it("can return to payment methods without closing checkout", async () => {
    const user = userEvent.setup()
    const onBack = vi.fn()
    render(
      <CashPaymentModal
        total={1_000}
        onClose={vi.fn()}
        onBack={onBack}
        onConfirm={vi.fn()}
      />,
    )

    await user.click(screen.getByRole("button", { name: /Changer de moyen de paiement/ }))
    expect(onBack).toHaveBeenCalledOnce()
  })
})
