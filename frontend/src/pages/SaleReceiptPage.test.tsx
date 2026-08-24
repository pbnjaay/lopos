// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { afterEach, describe, expect, it, vi } from "vitest"

import { getSaleReceipt } from "../api/sales"
import { getLocalSaleById } from "../db/sales"
import type { LocalSale } from "../db/types"
import type { SaleReceipt } from "../types/api"
import { SaleReceiptPage } from "./SaleReceiptPage"

vi.mock("../api/sales", () => ({ getSaleReceipt: vi.fn() }))
vi.mock("../db/sales", () => ({ getLocalSaleById: vi.fn() }))

const cashReceipt: SaleReceipt = {
  id: "sale-id",
  created_at: "2026-08-17T14:32:00Z",
  store: { id: "store-id", name: "Supérette Test" },
  cash_register: { id: "register-id", name: "Caisse 01" },
  cashier: { id: 7, username: "cashier" },
  status: "COMPLETED",
  subtotal: "1000.00",
  discount: "0.00",
  total: "1000.00",
  payment: {
    method: "CASH",
    amount: "1000.00",
    received_amount: "2000.00",
    change_amount: "1000.00",
  },
  items: [
    {
      product_id: "product-id",
      product_name: "Coca 50cl",
      unit_price: "500.00",
      quantity: 2,
      line_total: "1000.00",
    },
  ],
}

function renderReceipt(receipt: SaleReceipt) {
  vi.mocked(getLocalSaleById).mockResolvedValue(null)
  vi.mocked(getSaleReceipt).mockResolvedValue(receipt)
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })

  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/sales/${receipt.id}/receipt`]}>
        <Routes>
          <Route path="/sales/:saleId/receipt" element={<SaleReceiptPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe("SaleReceiptPage", () => {
  it("renders historical cash sale data and prints it", async () => {
    const user = userEvent.setup()
    const printMock = vi.spyOn(window, "print").mockImplementation(() => undefined)
    renderReceipt(cashReceipt)

    expect(await screen.findByRole("heading", { name: "Supérette Test" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Ticket de vente" })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Retour à la vente" })).toHaveAttribute("href", `/sales/${cashReceipt.id}`)
    expect(screen.getByText("N° ticket : SALE-ID")).toBeInTheDocument()
    expect(screen.getByText("Coca 50cl")).toBeInTheDocument()
    expect(screen.getByText("2 × 500 FCFA")).toBeInTheDocument()
    expect(screen.getAllByText("1 000 FCFA")).toHaveLength(3)
    expect(screen.getByText("Espèces")).toBeInTheDocument()
    expect(screen.getByText("Reçu")).toBeInTheDocument()
    expect(screen.getByText("2 000 FCFA")).toBeInTheDocument()
    expect(screen.getByText("Monnaie")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Imprimer le ticket" }))
    expect(printMock).toHaveBeenCalledOnce()
  })

  it.each([
    ["WAVE", "Wave"],
    ["ORANGE_MONEY", "Orange Money"],
  ] as const)("shows %s without received cash or change", async (method, label) => {
    renderReceipt({
      ...cashReceipt,
      payment: {
        method,
        amount: "1000.00",
        received_amount: null,
        change_amount: null,
      },
    })

    expect(await screen.findByText(label)).toBeInTheDocument()
    expect(screen.queryByText("Reçu")).not.toBeInTheDocument()
    expect(screen.queryByText("Monnaie")).not.toBeInTheDocument()
  })

  it("renders a pending-sync local sale without calling the API", async () => {
    const localSale: LocalSale = {
      id: "0f9e8d7c-1234-4a5b-9c6d-abcdef012345",
      serverId: null,
      syncEventId: "sync-event-" + Math.random().toString(36).slice(2),
      cashSessionId: "session-id",
      storeId: "store-id",
      storeName: "Supérette Test",
      cashRegisterId: "register-id",
      cashRegisterName: "Caisse 01",
      cashierId: 7,
      cashierName: "cashier",
      createdAt: "2026-08-17T14:32:00Z",
      status: "PENDING_SYNC",
      conflictCode: null,
      conflictMessage: null,
      items: [
        {
          productId: "product-id",
          productName: "Coca 50cl",
          unitPrice: 500,
          quantity: 2,
          lineTotal: 1_000,
        },
      ],
      payment: { method: "CASH", amount: 1_000, receivedAmount: 2_000, changeAmount: 1_000 },
      subtotal: 1_000,
      discount: 0,
      total: 1_000,
    }
    vi.mocked(getLocalSaleById).mockResolvedValue(localSale)
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    })

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/sales/${localSale.id}/receipt`]}>
          <Routes>
            <Route path="/sales/:saleId/receipt" element={<SaleReceiptPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(await screen.findByText("Coca 50cl")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Retour aux ventes en attente" })).toHaveAttribute("href", "/sales/pending")
    expect(screen.getByText("N° ticket : 0F9E8D7C")).toBeInTheDocument()
    expect(screen.getByText(/référence locale/i)).toHaveTextContent("0F9E8D7C")
    expect(getSaleReceipt).not.toHaveBeenCalled()
  })
})
