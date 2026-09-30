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

    expect(screen.getByRole("button", { name: "Valider le paiement" })).toBeDisabled()
    await user.type(screen.getByLabelText("Montant reçu"), "2000")

    const changePreview = screen.getByText("Monnaie à rendre").parentElement!
    expect(within(changePreview).getByText("1 000 FCFA")).toBeInTheDocument()
    const confirmButton = screen.getByRole("button", { name: "Valider et rendre 1 000 FCFA" })
    expect(confirmButton).toBeEnabled()
    await user.click(confirmButton)
    expect(onConfirm).toHaveBeenCalledWith(2_000)
  })

  it("offers a partial payment as a distinct action instead of blocking, for a mixed payment", async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(<CashPaymentModal total={1_000} onClose={vi.fn()} onConfirm={onConfirm} />)

    await user.type(screen.getByLabelText("Montant reçu"), "500")

    const continueButton = screen.getByRole("button", { name: "Continuer avec un autre moyen" })
    expect(continueButton).toBeEnabled()
    expect(screen.queryByRole("button", { name: /^Valider/ })).not.toBeInTheDocument()
    expect(screen.getByText("Reste à payer").parentElement).toHaveTextContent("500 FCFA")
    await user.click(continueButton)
    expect(onConfirm).toHaveBeenCalledWith(500)
  })

  it("keeps validation disabled with nothing typed yet", () => {
    render(<CashPaymentModal total={1_000} onClose={vi.fn()} onConfirm={vi.fn()} />)

    expect(screen.getByRole("button", { name: "Valider le paiement" })).toBeDisabled()
  })

  it("shows the full total as owed before anything has been typed", () => {
    render(<CashPaymentModal total={1_000} onClose={vi.fn()} onConfirm={vi.fn()} />)

    expect(screen.getByText("Reste à payer").parentElement).toHaveTextContent("1 000 FCFA")
  })

  it("labels the total \"Reste à encaisser\" once a first payment has already been applied", () => {
    render(<CashPaymentModal total={400} isPartial onClose={vi.fn()} onConfirm={vi.fn()} />)

    expect(screen.getByText("Reste à encaisser").parentElement).toHaveTextContent("400 FCFA")
  })

  it("submits with Enter once the amount is sufficient, and only once", async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(<CashPaymentModal total={1_000} onClose={vi.fn()} onConfirm={onConfirm} />)

    await user.type(screen.getByLabelText("Montant reçu"), "2000{Enter}")

    expect(onConfirm).toHaveBeenCalledOnce()
    expect(onConfirm).toHaveBeenCalledWith(2_000)
  })

  it("submits a partial amount with Enter, same as clicking the continue action", async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(<CashPaymentModal total={1_000} onClose={vi.fn()} onConfirm={onConfirm} />)

    await user.type(screen.getByLabelText("Montant reçu"), "500{Enter}")

    expect(onConfirm).toHaveBeenCalledOnce()
    expect(onConfirm).toHaveBeenCalledWith(500)
  })

  it("does not submit with Enter while nothing has been typed", async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(<CashPaymentModal total={1_000} onClose={vi.fn()} onConfirm={onConfirm} />)

    screen.getByLabelText("Montant reçu").focus()
    await user.keyboard("{Enter}")

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
    const confirmButton = screen.getByRole("button", { name: "Valider et rendre 1 000 FCFA" })

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
    expect(screen.getByLabelText("Montant reçu")).toHaveValue("2 000")

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

  describe("payment state for a 4 150 FCFA total", () => {
    function statusFor(typed: string) {
      render(<CashPaymentModal total={4_150} onClose={vi.fn()} onConfirm={vi.fn()} onCredit={vi.fn()} />)
      if (typed) fireEvent.change(screen.getByLabelText("Montant reçu"), { target: { value: typed } })
      const submit = screen.getAllByRole("button").find((button) => button.getAttribute("type") === "submit")!
      return { status: document.querySelector(".payment-status")!, submit }
    }

    it.each([
      ["", "Reste à payer", "4 150 FCFA", "Valider le paiement", "Mettre 4 150 FCFA au cahier"],
      ["2000", "Reste à payer", "2 150 FCFA", "Continuer avec un autre moyen", "Mettre 2 150 FCFA au cahier"],
      ["4150", "Paiement exact", "Rien à rendre", "Valider le paiement", null],
      ["4500", "Monnaie à rendre", "350 FCFA", "Valider et rendre 350 FCFA", null],
      ["5000", "Monnaie à rendre", "850 FCFA", "Valider et rendre 850 FCFA", null],
      ["10000", "Monnaie à rendre", "5 850 FCFA", "Valider et rendre 5 850 FCFA", null],
    ])("received %s → %s %s", (typed, label, amount, submitLabel, creditLabel) => {
      const { status, submit } = statusFor(typed)

      // Un seul état financier à la fois, jamais le total brut une fois un versement saisi.
      expect(status).toHaveTextContent(`${label}${amount}`)
      expect(status).not.toHaveTextContent(label === "Reste à payer" ? "Monnaie" : "Reste")
      expect(submit).toHaveTextContent(submitLabel)
      if (creditLabel) {
        expect(screen.getByRole("button", { name: creditLabel })).toBeInTheDocument()
      } else {
        expect(screen.queryByRole("button", { name: /cahier/i })).not.toBeInTheDocument()
        expect(screen.getByRole("button", { name: "Annuler" })).toBeInTheDocument()
      }
    })
  })

  it("puts only the real remainder on the book, passing what was received", async () => {
    const user = userEvent.setup()
    const onCredit = vi.fn()
    render(
      <CashPaymentModal total={4_150} onClose={vi.fn()} onConfirm={vi.fn()} onCredit={onCredit} />,
    )

    await user.type(screen.getByLabelText("Montant reçu"), "2000")
    await user.click(screen.getByRole("button", { name: "Mettre 2 150 FCFA au cahier" }))

    expect(onCredit).toHaveBeenCalledWith(2_000)
  })

  it("offers the exact amount plus a few contextual notes", () => {
    render(<CashPaymentModal total={4_150} onClose={vi.fn()} onConfirm={vi.fn()} />)

    const quickAmounts = within(screen.getByLabelText("Montants rapides")).getAllByRole("button")
    expect(quickAmounts.map((button) => button.textContent)).toEqual([
      "Montant exact",
      "4 500 FCFA",
      "5 000 FCFA",
      "10 000 FCFA",
    ])
  })

  it("validates the exact amount right away with Enter", async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(<CashPaymentModal total={4_150} onClose={vi.fn()} onConfirm={onConfirm} />)

    await user.click(screen.getByRole("button", { name: "Montant exact" }))
    expect(screen.getByLabelText("Montant reçu")).toHaveValue("4 150")
    expect(screen.getByLabelText("Montant reçu")).toHaveFocus()
    await user.keyboard("{Enter}")

    expect(onConfirm).toHaveBeenCalledWith(4_150)
  })

  it("autofocuses the amount field when opened", () => {
    render(<CashPaymentModal total={4_150} onClose={vi.fn()} onConfirm={vi.fn()} />)

    expect(screen.getByLabelText("Montant reçu")).toHaveFocus()
  })

  it("ignores non-digit input", async () => {
    const user = userEvent.setup()
    render(<CashPaymentModal total={4_150} onClose={vi.fn()} onConfirm={vi.fn()} />)

    await user.type(screen.getByLabelText("Montant reçu"), "2a0,0.0")

    expect(screen.getByLabelText("Montant reçu")).toHaveValue("2 000")
  })

  it("brings focus back to the amount when an error comes back", () => {
    const { rerender } = render(
      <CashPaymentModal total={4_150} onClose={vi.fn()} onConfirm={vi.fn()} />,
    )
    screen.getByRole("button", { name: "Annuler" }).focus()

    rerender(
      <CashPaymentModal
        total={4_150}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        errorMessage="La session de caisse est fermée."
      />,
    )

    expect(screen.getByRole("alert")).toHaveTextContent("La session de caisse est fermée.")
    expect(screen.getByLabelText("Montant reçu")).toHaveFocus()
  })
})
