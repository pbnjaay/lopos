// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"

import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { Button } from "./Button"

afterEach(cleanup)

describe("Button", () => {
  it("keeps the resting label in the layout while loading, so nothing shifts", () => {
    render(
      <Button variant="primary" loading loadingLabel="Enregistrement…">
        Confirmer le retour
      </Button>,
    )

    // Le libellé au repos reste dans le flux (masqué) : la cellule de grille
    // est déjà dimensionnée pour le plus long des deux textes.
    const resting = screen.getByText("Confirmer le retour")
    expect(resting).toHaveAttribute("data-stack-hidden", "true")
    expect(screen.getByText("Enregistrement…")).toBeInTheDocument()
  })

  it("names itself by the loading label while busy", () => {
    render(
      <Button variant="primary" loading loadingLabel="Validation…">
        Valider
      </Button>,
    )

    const button = screen.getByRole("button", { name: "Validation…" })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute("aria-busy", "true")
  })

  it("cannot be activated twice while loading", async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(
      <Button variant="primary" loading onClick={onClick}>
        Encaisser
      </Button>,
    )

    await user.click(screen.getByRole("button"))
    expect(onClick).not.toHaveBeenCalled()
  })

  it("carries one variant and one size class, never a bespoke style", () => {
    render(
      <Button variant="destructive" size="sm">
        Vider
      </Button>,
    )

    const button = screen.getByRole("button", { name: "Vider" })
    expect(button.className.split(" ").filter(Boolean)).toEqual([
      "button",
      "button-destructive",
      "button-sm",
    ])
  })
})
