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
    expect(screen.getByRole("alert")).toHaveTextContent("il manque 500 FCFA")
  })

  it("closes with Escape", () => {
    const onClose = vi.fn()
    render(<CashPaymentModal total={1_000} onClose={onClose} onConfirm={vi.fn()} />)

    fireEvent.keyDown(window, { key: "Escape" })
    expect(onClose).toHaveBeenCalledOnce()
  })
})
