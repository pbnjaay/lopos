import { useEffect, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "react-router-dom"

import { completeSale } from "../api/sales"
import { getStore } from "../api/stores"
import { ApiError, isApiUnavailable } from "../api/client"
import {
  trackCheckoutOpened,
  trackPaymentMethodSelected,
  trackSaleCompleted,
  trackSaleFailed,
} from "../analytics/events"
import { InsufficientLocalStockError, createLocalSale } from "../db/sales"
import { updateLocalCashSessionStoreName } from "../db/sessions"
import { useCurrentUser } from "../features/auth/queries"
import { Cart } from "../features/cart/Cart"
import { useCart } from "../features/cart/useCart"
import { usePosSession } from "../features/cash-session/queries"
import { CashPaymentModal } from "../features/checkout/CashPaymentModal"
import { MobileMoneyConfirmation } from "../features/checkout/MobileMoneyConfirmation"
import { PaymentMethodModal } from "../features/checkout/PaymentMethodModal"
import { getLastPaymentMethod, storeLastPaymentMethod } from "../features/checkout/paymentMethodStorage"
import { SaleSuccessModal } from "../features/checkout/SaleSuccessModal"
import { OfflineBanner } from "../features/offline/OfflineBanner"
import { useNetworkStatus } from "../features/offline/useNetworkStatus"
import { pendingSalesCountQueryKey } from "../features/offline/usePendingSalesCount"
import { ProductSearch } from "../features/products/ProductSearch"
import { useProductCatalogCache } from "../features/products/queries"
import { type ReceiptView, receiptViewFromApiSale, receiptViewFromLocalSale } from "../features/sales/receiptView"
import { useSyncStatus } from "../features/sync/useSyncStatus"
import type { PaymentMethod } from "../types/api"
import { toBackendMoney } from "../utils/money"
import { milliToBackendQuantity, parseQuantityToMilli } from "../utils/quantity"

type CheckoutPayment = {
  method: PaymentMethod
  receivedAmount?: number
}

const checkoutFKeyToMethod: Record<string, PaymentMethod> = {
  F1: "CASH",
  F2: "WAVE",
  F3: "ORANGE_MONEY",
}

export function PosPage() {
  const user = useCurrentUser().data!
  const { ownSession, selectedRegister, localSession } = usePosSession(user)
  const isOnline = useNetworkStatus()
  const { pendingCount, conflictCount, isSyncing, triggerSync } = useSyncStatus()
  const queryClient = useQueryClient()
  const cart = useCart(ownSession?.id ?? null)
  const [checkoutStep, setCheckoutStep] = useState<"METHODS" | PaymentMethod | null>(null)
  const [completedSale, setCompletedSale] = useState<ReceiptView | null>(null)
  const [lastPaymentMethod, setLastPaymentMethod] = useState<PaymentMethod | null>(
    getLastPaymentMethod,
  )
  useProductCatalogCache(selectedRegister?.store_id ?? null)
  const storeQuery = useQuery({
    queryKey: ["stores", selectedRegister?.store_id],
    queryFn: () => getStore(selectedRegister!.store_id),
    enabled: selectedRegister !== null,
    staleTime: 60_000,
  })

  useEffect(() => {
    if (!ownSession || !storeQuery.data) return
    void updateLocalCashSessionStoreName(ownSession.id, storeQuery.data.name).catch(
      () => undefined,
    )
  }, [ownSession, storeQuery.data])

  const saleMutation = useMutation({
    mutationFn: async (payment: CheckoutPayment): Promise<ReceiptView> => {
      if (isOnline) {
        try {
          const sale = await completeSale({
            cash_session_id: ownSession!.id,
            items: cart.items.map((item) => item.saleUnit ? ({
              product_id: item.productId,
              quantity: milliToBackendQuantity(item.quantityMilli ?? (item.quantity ?? 0) * 1000),
              ...(item.unitPrice !== (item.catalogUnitPrice ?? item.unitPrice) ? { unit_price: toBackendMoney(item.unitPrice) } : {}),
            }) : ({ product_id: item.productId, quantity: item.quantity ?? 1 })),
            payment:
              payment.method === "CASH"
                ? { method: "CASH", received_amount: toBackendMoney(payment.receivedAmount!) }
                : { method: payment.method },
          })
          return receiptViewFromApiSale(sale, {
            storeName: storeQuery.data?.name ?? localSession?.storeName ?? "",
            cashRegisterName: selectedRegister?.name ?? "",
            cashierName: user.first_name || user.username,
          })
        } catch (error) {
          // navigator.onLine can report "online" while the server is
          // actually unreachable (dropped packets, VPN gone stale...). Rather
          // than leave the cashier stuck on a failed payment, treat this
          // submission as offline: the sale still gets recorded locally and
          // will sync once connectivity is genuinely restored.
          if (!isApiUnavailable(error)) throw error
        }
      }

      if (!localSession) {
        throw new Error("Aucune session de caisse locale disponible hors ligne.")
      }

      const sale = await createLocalSale({
        session: localSession,
        items: cart.items.map((item) => item.saleUnit ? ({
          productId: item.productId,
          quantityMilli: item.quantityMilli ?? (item.quantity ?? 0) * 1000,
          unitPrice: item.unitPrice,
        }) : ({ productId: item.productId, quantity: item.quantity ?? 1 })),
        payment: { method: payment.method, receivedAmount: payment.receivedAmount ?? null },
      })
      return receiptViewFromLocalSale(sale)
    },
    onSuccess: (sale) => {
      cart.clearCart()
      setCheckoutStep(null)
      setCompletedSale(sale)
      storeLastPaymentMethod(sale.payment.method)
      setLastPaymentMethod(sale.payment.method)
      void queryClient.invalidateQueries({ queryKey: ["products"] })
      void queryClient.invalidateQueries({ queryKey: pendingSalesCountQueryKey })
      if (sale.isPendingSync) void triggerSync()
      trackSaleCompleted({
        sale_id: sale.id,
        store_id: selectedRegister?.store_id ?? null,
        cash_register_id: selectedRegister?.id ?? null,
        cash_session_id: ownSession?.id ?? null,
        payment_method: sale.payment.method,
        items_count: sale.items.length,
        total_amount: sale.total,
        offline: sale.isPendingSync,
      })
    },
    onError: (error, payment) => {
      if (
        (error instanceof ApiError &&
          ["INSUFFICIENT_STOCK", "PRODUCT_INACTIVE", "PRODUCT_NOT_FOUND"].includes(
            error.code ?? "",
          )) ||
        error instanceof InsufficientLocalStockError
      ) {
        void queryClient.invalidateQueries({ queryKey: ["products"] })
      }
      if (error instanceof ApiError && error.code === "CASH_SESSION_CLOSED") {
        void queryClient.invalidateQueries({
          queryKey: ["cash-registers", selectedRegister?.id, "current-session"],
        })
      }
      trackSaleFailed({
        error_code:
          error instanceof ApiError
            ? error.code ?? "UNKNOWN"
            : error instanceof InsufficientLocalStockError
              ? "INSUFFICIENT_STOCK"
              : "NETWORK_ERROR",
        payment_method: payment.method,
        offline: !isOnline,
      })
    },
  })

  function handleAddProduct(product: Parameters<typeof cart.addItem>[0]) {
    if (product.saleUnit === "KG") {
      const raw = window.prompt(`Quantité de ${product.name} en kg`, "0,300")
      if (raw === null) return
      const quantityMilli = parseQuantityToMilli(raw)
      if (quantityMilli === null) return
      cart.addItem(product, quantityMilli)
      return
    }
    cart.addItem(product, 1000)
  }

  async function submitPayment(payment: CheckoutPayment) {
    if (!ownSession || cart.items.length === 0) return
    await saleMutation.mutateAsync(payment)
  }

  function handleCashPayment(receivedAmount: number) {
    return submitPayment({ method: "CASH", receivedAmount })
  }

  function handleMobilePayment(method: Exclude<PaymentMethod, "CASH">) {
    return submitPayment({ method })
  }

  function focusProductSearch() {
    window.requestAnimationFrame(() => {
      document.getElementById("product-search-input")?.focus()
    })
  }

  function closeCheckout() {
    setCheckoutStep(null)
    focusProductSearch()
  }

  // F1/F2/F3 open a payment screen directly from the POS, bypassing the
  // method-selection modal entirely. Safe to intercept unconditionally
  // (unlike digits or Enter) because function keys never collide with
  // typing in the barcode/search field — a real scanner never emits them.
  // Only active while checkout is fully closed, so it can't hijack a flow
  // already in progress.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.repeat) return
      const method = checkoutFKeyToMethod[event.key]
      if (!method) return
      event.preventDefault()
      if (checkoutStep !== null || completedSale !== null) return
      if (!ownSession || cart.items.length === 0) return
      saleMutation.reset()
      setCheckoutStep(method)
      trackCheckoutOpened({ cart_items_count: cart.items.length, cart_total: cart.total })
      trackPaymentMethodSelected({ method })
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [checkoutStep, completedSale, ownSession, cart.items.length, cart.total, saleMutation])

  return (
    <main className="pos-page">
      <header className="pos-heading">
        <div>
          <p className="eyebrow">Point de vente</p>
          <h1>{storeQuery.data?.name ?? localSession?.storeName ?? "Magasin"}</h1>
          <p className="pos-register-name">{selectedRegister?.name ?? "Caisse"}</p>
        </div>
        <div className="session-summary">
          <span className="session-badge">Session {ownSession?.status}</span>
          <span>Caissier : {user.first_name || user.username}</span>
          <Link className="close-session-link" to="/cash/close">
            Clôturer la caisse
          </Link>
          <Link className="close-session-link" to="/returns/new">Retour marchandise</Link>
        </div>
      </header>

      <div className="offline-status-row">
        <OfflineBanner
          pendingSalesCount={pendingCount}
          conflictSalesCount={conflictCount}
          isSyncing={isSyncing}
        />
        {pendingCount > 0 || conflictCount > 0 ? (
          <Link className="text-button" to="/sales/pending">
            Voir les ventes en attente
          </Link>
        ) : null}
      </div>

      {storeQuery.error && !localSession?.storeName ? (
        <p className="form-error" role="alert">
          {storeQuery.error.message}
        </p>
      ) : null}

      {selectedRegister ? (
        <div className="pos-grid">
          <ProductSearch
            storeId={selectedRegister.store_id}
            onProductSelect={handleAddProduct}
          />
          <Cart
            items={cart.items}
            total={cart.total}
            onIncrement={cart.incrementItem}
            onDecrement={cart.decrementItem}
            onQuantityChange={cart.setItemQuantity}
            onPriceChange={cart.setItemPrice}
            onRemove={cart.removeItem}
            onClear={cart.clearCart}
            onCheckout={() => {
              saleMutation.reset()
              setCheckoutStep("METHODS")
              trackCheckoutOpened({
                cart_items_count: cart.items.length,
                cart_total: cart.total,
              })
            }}
          />
        </div>
      ) : (
        <p className="form-error" role="alert">
          Impossible de déterminer le magasin de cette caisse.
        </p>
      )}
      {checkoutStep === "METHODS" ? (
        <PaymentMethodModal
          total={cart.total}
          lastUsedMethod={lastPaymentMethod}
          onClose={closeCheckout}
          onSelect={(method) => {
            saleMutation.reset()
            setCheckoutStep(method)
            trackPaymentMethodSelected({ method })
          }}
        />
      ) : null}
      {checkoutStep === "CASH" ? (
        <CashPaymentModal
          total={cart.total}
          isSubmitting={saleMutation.isPending}
          errorMessage={saleMutation.error?.message}
          onBack={() => {
            saleMutation.reset()
            setCheckoutStep("METHODS")
          }}
          onClose={() => {
            if (!saleMutation.isPending) closeCheckout()
          }}
          onConfirm={handleCashPayment}
        />
      ) : null}
      {checkoutStep === "WAVE" || checkoutStep === "ORANGE_MONEY" ? (
        <MobileMoneyConfirmation
          method={checkoutStep}
          total={cart.total}
          isSubmitting={saleMutation.isPending}
          errorMessage={saleMutation.error?.message}
          onBack={() => {
            saleMutation.reset()
            setCheckoutStep("METHODS")
          }}
          onClose={() => {
            if (!saleMutation.isPending) closeCheckout()
          }}
          onConfirm={() => handleMobilePayment(checkoutStep)}
        />
      ) : null}
      {completedSale ? (
        <SaleSuccessModal
          sale={completedSale}
          onNewSale={() => {
            setCompletedSale(null)
            focusProductSearch()
          }}
        />
      ) : null}
    </main>
  )
}
