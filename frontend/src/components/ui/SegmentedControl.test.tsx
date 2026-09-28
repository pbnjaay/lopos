// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"

import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { afterEach, describe, expect, it } from "vitest"

import { SegmentedControl } from "./SegmentedControl"

function Harness() {
  const [value, setValue] = useState<"a" | "b" | "c">("a")
  return (
    <SegmentedControl
      label="Filtre"
      value={value}
      onChange={setValue}
      options={[
        { value: "a", label: "Tous" },
        { value: "b", label: "Avec solde" },
        { value: "c", label: "Soldés" },
      ]}
    />
  )
}

afterEach(cleanup)

describe("SegmentedControl", () => {
  it("is a single tab stop moved with the arrow keys", async () => {
    const user = userEvent.setup()
    render(<Harness />)

    expect(screen.getByRole("radiogroup", { name: "Filtre" })).toBeInTheDocument()
    expect(screen.getByRole("radio", { name: "Tous" })).toHaveAttribute("aria-checked", "true")
    await user.tab()
    expect(screen.getByRole("radio", { name: "Tous" })).toHaveFocus()

    await user.keyboard("{ArrowRight}")
    expect(screen.getByRole("radio", { name: "Avec solde" })).toHaveAttribute("aria-checked", "true")
    expect(screen.getByRole("radio", { name: "Avec solde" })).toHaveFocus()

    await user.keyboard("{ArrowLeft}{ArrowLeft}")
    expect(screen.getByRole("radio", { name: "Soldés" })).toHaveAttribute("aria-checked", "true")
  })
})
