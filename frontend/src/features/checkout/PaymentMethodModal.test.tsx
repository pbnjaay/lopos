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
})
