// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { afterEach, describe, expect, it, vi } from "vitest"

import { createSaleReturn, getSaleReceipt } from "../api/sales"
import { saleReceiptQueryKey } from "../features/sales/queries"
import type { CashSession, CurrentUser, SaleReceipt, SaleReturn } from "../types/api"
import { SaleReturnPage } from "./SaleReturnPage"

vi.mock("../api/sales", () => ({
  createSaleReturn: vi.fn(),
  getSaleReceipt: vi.fn(),
}))

const user: CurrentUser = {
  id: 7,
  username: "cashier",
  email: "",
  first_name: "Awa",
  last_name: "",
  is_staff: false,
}

const session: CashSession = {
  id: "session-id",
  cash_register_id: "register-id",
  cashier_id: user.id,
  opening_balance: "10000.00",
  status: "OPEN",
  opened_at: "2026-08-24T10:00:00Z",
  closing_balance: null,
  expected_balance: null,
  difference: null,
  closed_at: null,
}

const sale: SaleReceipt = {
  id: "a12f0000-0000-0000-0000-000000000000",
  created_at: "2026-08-24T12:00:00Z",
  store: { id: "store-id", name: "Boutique A" },
  cash_register: { id: "register-id", name: "Caisse 01" },
  cashier: { id: user.id, username: user.username },
  status: "COMPLETED",
  subtotal: "2000.00",
  discount: "0.00",
  total: "2000.00",
  returned_total: "500.00",
  net_total: "1500.00",
  payment: { method: "WAVE", amount: "2000.00", received_amount: null, change_amount: null },
  items: [
    { id: "item-1", product_id: "product-1", product_name: "Riz", sale_unit: "KG", unit_price: "1000.00", quantity: "2.000", quantity_returned: "0.500", quantity_returnable: "1.500", line_total: "2000.00" },
    { id: "item-2", product_id: "product-2", product_name: "Sucre", sale_unit: "UNIT", unit_price: "500.00", quantity: "1.000", quantity_returned: "1.000", quantity_returnable: "0.000", line_total: "500.00" },
  ],
}

const completedReturn: SaleReturn = {
  id: "return-id",
  reference: "RET-A12F",
  original_sale_id: sale.id,
  total_refund: "1500.00",
  payment_method: "WAVE",
  status: "COMPLETED",
  created_at: "2026-08-24T13:00:00Z",
  items: [{
    id: "return-item-id",
    product_name: "Riz",
    sale_unit: "KG",
    quantity: "1.500",
    unit_price: "1000.00",
    refund_amount: "1500.00",
    restock: true,
  }],
}

vi.mock("../features/auth/queries", () => ({ useCurrentUser: () => ({ data: user }) }))
vi.mock("../features/cash-session/queries", () => ({ usePosSession: () => ({ ownSession: session }) }))
vi.mock("../features/offline/useNetworkStatus", () => ({ useNetworkStatus: () => true }))

function renderPage(queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  vi.mocked(getSaleReceipt).mockResolvedValue(sale)
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/sales/${sale.id}/return`]}>
        <Routes><Route path="/sales/:saleId/return" element={<SaleReturnPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return queryClient
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("SaleReturnPage", () => {
  it("uses the shared navigation and blocks unavailable or excessive quantities", async () => {
    const actor = userEvent.setup()
    renderPage()

    expect(await screen.findByRole("heading", { name: "Ticket A12F0000" })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Retour à la vente" })).toHaveAttribute("href", `/sales/${sale.id}`)
    expect(document.getElementById("return-quantity-item-2")).toBeDisabled()

    await actor.click(document.getElementById("return-quantity-item-1")!)
    const quantity = screen.getByRole("textbox", { name: "Quantité à retourner" })
    await actor.type(quantity, "2")
    await actor.keyboard("{Enter}")
    expect(document.getElementById("return-quantity-item-1")).toHaveTextContent("0")
    expect(screen.getByRole("button", { name: /Rembourser/ })).toBeDisabled()
  })

  it("lets the cashier adjust a return quantity directly from the counter", async () => {
    const actor = userEvent.setup()
    renderPage()

    await screen.findByRole("heading", { name: "Ticket A12F0000" })
    const quantity = document.getElementById("return-quantity-item-1")!
    expect(quantity).toHaveTextContent("0")
    await actor.click(screen.getByRole("button", { name: "Augmenter la quantité de Riz" }))
    expect(quantity).toHaveTextContent("0,1 kg")
    expect(screen.getByText("100 FCFA", { selector: ".return-total .money" })).toBeInTheDocument()

    await actor.click(screen.getByRole("button", { name: "Diminuer la quantité de Riz" }))
    expect(quantity).toHaveTextContent("0")
  })

  it("opens immediately from the sale-detail cache", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    queryClient.setQueryData(saleReceiptQueryKey(sale.id, session.id), sale)

    renderPage(queryClient)

    expect(screen.getByRole("heading", { name: "Ticket A12F0000" })).toBeInTheDocument()
    expect(screen.queryByText("Chargement de la vente…")).not.toBeInTheDocument()
  })

  it("selects every returnable item and refunds directly through the original method", async () => {
    const actor = userEvent.setup()
    vi.mocked(createSaleReturn).mockResolvedValue(completedReturn)
    renderPage()

    await screen.findByRole("heading", { name: "Ticket A12F0000" })
    expect(screen.getByLabelText("Mode de remboursement")).toHaveValue("WAVE")

    await actor.click(screen.getByRole("button", { name: "Tout sélectionner" }))

    expect(document.getElementById("return-quantity-item-1")).toHaveTextContent("1,5 kg")
    expect(screen.getByText("1 500 FCFA", { selector: ".return-total .money" })).toBeInTheDocument()

    await actor.click(screen.getByRole("button", { name: "Rembourser 1 500 FCFA par Wave" }))

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(await screen.findByRole("heading", { name: "Remboursement effectué" })).toHaveFocus()
    expect(createSaleReturn).toHaveBeenCalledWith(expect.objectContaining({
      idempotency_key: expect.any(String),
      payment_method: "WAVE",
      items: [{ sale_item_id: "item-1", quantity: "1.500", restock: true }],
    }))
    expect(screen.getByRole("link", { name: "Imprimer le ticket" })).toHaveAttribute(
      "href",
      "/returns/return-id/receipt?print=1",
    )
  })

  it("asks for confirmation only when the refund method differs from the payment", async () => {
    const actor = userEvent.setup()
    vi.mocked(createSaleReturn).mockResolvedValue({ ...completedReturn, payment_method: "CASH" })
    renderPage()

    await screen.findByRole("heading", { name: "Ticket A12F0000" })
    await actor.click(screen.getByRole("button", { name: "Tout sélectionner" }))
    await actor.selectOptions(screen.getByLabelText("Mode de remboursement"), "CASH")

    expect(screen.getByText("Paiement initial : Wave.")).toBeInTheDocument()
    await actor.click(screen.getByRole("button", { name: "Rembourser 1 500 FCFA par espèces" }))

    expect(screen.getByRole("dialog", { name: "Confirmer un autre mode ?" })).toBeInTheDocument()
    expect(createSaleReturn).not.toHaveBeenCalled()

    await actor.click(screen.getByRole("button", { name: "Confirmer le remboursement" }))
    expect(await screen.findByRole("heading", { name: "Remboursement effectué" })).toBeInTheDocument()
    expect(createSaleReturn).toHaveBeenCalledWith(expect.objectContaining({ payment_method: "CASH" }))
  })

  it("reuses the same idempotency key when a submission must be retried", async () => {
    const actor = userEvent.setup()
    vi.mocked(createSaleReturn)
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockResolvedValueOnce(completedReturn)
    renderPage()

    await screen.findByRole("heading", { name: "Ticket A12F0000" })
    await actor.click(screen.getByRole("button", { name: "Tout sélectionner" }))
    const refundButton = screen.getByRole("button", { name: "Rembourser 1 500 FCFA par Wave" })

    await actor.click(refundButton)
    await waitFor(() => expect(createSaleReturn).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(refundButton).toBeEnabled())
    await actor.click(refundButton)

    expect(await screen.findByRole("heading", { name: "Remboursement effectué" })).toBeInTheDocument()
    const firstKey = vi.mocked(createSaleReturn).mock.calls[0]?.[0].idempotency_key
    const secondKey = vi.mocked(createSaleReturn).mock.calls[1]?.[0].idempotency_key
    expect(firstKey).toBeTruthy()
    expect(secondKey).toBe(firstKey)
  })
})
