import { describe, expect, it } from "vitest"

import { readSaleOrigin, saleOriginBack, withSaleOrigin } from "./origin"

describe("provenance d'une consultation de vente", () => {
  it("ne retient que les provenances connues", () => {
    expect(readSaleOrigin(new URLSearchParams("from=pos"))).toBe("pos")
    expect(readSaleOrigin(new URLSearchParams("from=pending"))).toBe("pending")
    expect(readSaleOrigin(new URLSearchParams(""))).toBeNull()
    // Une valeur inventée dans l'URL ne doit pas produire un lien mort.
    expect(readSaleOrigin(new URLSearchParams("from=ailleurs"))).toBeNull()
  })

  it("ramène le caissier là d'où il vient", () => {
    expect(saleOriginBack("pos")).toEqual({
      to: "/pos",
      label: "Retour au point de vente",
    })
    expect(saleOriginBack("pending")).toEqual({
      to: "/sales/pending",
      label: "Retour aux ventes en attente",
    })
    expect(saleOriginBack(null)).toEqual({ to: "/sales", label: "Retour aux ventes" })
  })

  it("reporte la provenance sans casser la query existante", () => {
    expect(withSaleOrigin("/sales/abc", "pos")).toBe("/sales/abc?from=pos")
    expect(withSaleOrigin("/sales/abc/receipt?print=1", "pending")).toBe(
      "/sales/abc/receipt?print=1&from=pending",
    )
    // Sans provenance, le lien reste celui d'origine.
    expect(withSaleOrigin("/sales/abc", null)).toBe("/sales/abc")
  })
})
