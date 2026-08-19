// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"

import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { PaymentMethodModal } from "./PaymentMethodModal"

afterEach(cleanup)

describe("PaymentMethodModal", () => {
  it("offers all supported methods and selects Wave", async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<PaymentMethodModal total={1_000} onClose={vi.fn()} onSelect={onSelect} />)

    expect(screen.getByRole("button", { name: /Espèces/ })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Orange Money/ })).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: /Wave/ }))
    expect(onSelect).toHaveBeenCalledWith("WAVE")
  })

  it("selects a method with its function-key shortcut", async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<PaymentMethodModal total={1_000} onClose={vi.fn()} onSelect={onSelect} />)

    await user.keyboard("{F2}")
    expect(onSelect).toHaveBeenCalledWith("WAVE")

    await user.keyboard("{F3}")
    expect(onSelect).toHaveBeenCalledWith("ORANGE_MONEY")

    await user.keyboard("{F1}")
    expect(onSelect).toHaveBeenCalledWith("CASH")
  })

  it("leaves digits alone, since they belong to the cash keypad once CASH opens", async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<PaymentMethodModal total={1_000} onClose={vi.fn()} onSelect={onSelect} />)

    await user.keyboard("123")
    expect(onSelect).not.toHaveBeenCalled()
  })

  it("highlights and focuses the last used method", () => {
    const onSelect = vi.fn()
    render(
      <PaymentMethodModal
        total={1_000}
        lastUsedMethod="WAVE"
        onClose={vi.fn()}
        onSelect={onSelect}
      />,
    )

    const waveButton = screen.getByRole("button", { name: /Wave/ })
    expect(waveButton).toHaveTextContent("Dernier utilisé")
    expect(waveButton).toHaveFocus()
  })
})
