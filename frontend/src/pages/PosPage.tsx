import { useEffect, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "react-router-dom"

import { completeSale } from "../api/sales"
import { getStore } from "../api/stores"
import { ApiError } from "../api/client"
import { InsufficientLocalStockError, createLocalSale } from "../db/sales"
import { updateLocalCashSessionStoreName } from "../db/sessions"
import { useCurrentUser } from "../features/auth/queries"
import { Cart } from "../features/cart/Cart"
import { useCart } from "../features/cart/useCart"
import { usePosSession } from "../features/cash-session/queries"
import { CashPaymentModal } from "../features/checkout/CashPaymentModal"
import { MobileMoneyConfirmation } from "../features/checkout/MobileMoneyConfirmation"
import { PaymentMethodModal } from "../features/checkout/PaymentMethodModal"
import { SaleSuccessModal } from "../features/checkout/SaleSuccessModal"
import { OfflineBanner } from "../features/offline/OfflineBanner"
import { useNetworkStatus } from "../features/offline/useNetworkStatus"
import { ProductSearch } from "../features/products/ProductSearch"
import { useProductCatalogCache } from "../features/products/queries"
import { type ReceiptView, receiptViewFromApiSale, receiptViewFromLocalSale } from "../features/sales/receiptView"
import type { PaymentMethod } from "../types/api"
import { toBackendMoney } from "../utils/money"

type CheckoutPayment = {
  method: PaymentMethod
  receivedAmount?: number
}

export function PosPage() {
  const user = useCurrentUser().data!
  const { ownSession, selectedRegister, localSession } = usePosSession(user)
  const isOnline = useNetworkStatus()
  const queryClient = useQueryClient()
  const cart = useCart()
  const [checkoutStep, setCheckoutStep] = useState<"METHODS" | PaymentMethod | null>(null)
  const [completedSale, setCompletedSale] = useState<ReceiptView | null>(null)
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
        const sale = await completeSale({
          cash_session_id: ownSession!.id,
          items: cart.items.map((item) => ({
            product_id: item.productId,
            quantity: item.quantity,
          })),
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
      }

      if (!localSession) {
        throw new Error("Aucune session de caisse locale disponible hors ligne.")
      }

      const sale = await createLocalSale({
        session: localSession,
        items: cart.items.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
        })),
        payment: { method: payment.method, receivedAmount: payment.receivedAmount ?? null },
      })
      return receiptViewFromLocalSale(sale)
    },
    onSuccess: (sale) => {
      cart.clearCart()
      setCheckoutStep(null)
      setCompletedSale(sale)
      void queryClient.invalidateQueries({ queryKey: ["products"] })
    },
    onError: (error) => {
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
    },
  })

  function handleAddProduct(product: Parameters<typeof cart.addItem>[0]) {
    cart.addItem(product)
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
        </div>
      </header>

      <OfflineBanner />

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
            onRemove={cart.removeItem}
            onClear={cart.clearCart}
            onCheckout={() => {
              saleMutation.reset()
              setCheckoutStep("METHODS")
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
          onClose={closeCheckout}
          onSelect={(method) => {
            saleMutation.reset()
            setCheckoutStep(method)
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
