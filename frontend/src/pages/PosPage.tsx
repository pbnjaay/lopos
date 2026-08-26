import { useEffect, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { getStore } from "../api/stores"
import {
  trackCheckoutOpened,
  trackPaymentMethodSelected,
  trackSaleCompleted,
  trackSaleFailed,
} from "../analytics/events"
import {
  InsufficientLocalStockError,
  LocalSaleProductNotFoundError,
  createLocalSale,
} from "../db/sales"
import {
  getLocalCashSessionForRegister,
  saveLocalCashSession,
  updateLocalCashSessionStoreName,
} from "../db/sessions"
import type { LocalCashSession } from "../db/types"
import { useCurrentUser } from "../features/auth/queries"
import { Cart } from "../features/cart/Cart"
import { QuantityDialog } from "../features/cart/CartDialogs"
import { useCart } from "../features/cart/useCart"
import { usePosSession } from "../features/cash-session/queries"
import { CashPaymentModal } from "../features/checkout/CashPaymentModal"
import { MobileMoneyConfirmation } from "../features/checkout/MobileMoneyConfirmation"
import { PaymentMethodModal } from "../features/checkout/PaymentMethodModal"
import { getLastPaymentMethod, storeLastPaymentMethod } from "../features/checkout/paymentMethodStorage"
import { SaleSuccessModal } from "../features/checkout/SaleSuccessModal"
import { useNetworkStatus } from "../features/offline/useNetworkStatus"
import { pendingSalesCountQueryKey } from "../features/offline/usePendingSalesCount"
import { ProductSearch } from "../features/products/ProductSearch"
import { useProductCatalog } from "../features/products/queries"
import type { CatalogProduct } from "../features/products/types"
import { type ReceiptView, receiptViewFromLocalSale } from "../features/sales/receiptView"
import { useSyncStatus } from "../features/sync/useSyncStatus"
import type { PaymentMethod } from "../types/api"

type CheckoutPayment = {
  method: PaymentMethod
  receivedAmount?: number
}

const checkoutFKeyToMethod: Record<string, PaymentMethod> = {
  F1: "CASH",
  F2: "WAVE",
  F3: "ORANGE_MONEY",
}

function getCheckoutErrorMessage(error: Error | null): string | undefined {
  if (!error) return undefined
  if (
    error instanceof InsufficientLocalStockError ||
    error instanceof LocalSaleProductNotFoundError
  ) {
    return error.message
  }
  return "Impossible d’enregistrer la vente sur cet appareil. Réessayez avant de poursuivre."
}

export function PosPage() {
  const user = useCurrentUser().data!
  const { ownSession, selectedRegister, localSession } = usePosSession(user)
  const isOnline = useNetworkStatus()
  const { triggerSync } = useSyncStatus()
  const queryClient = useQueryClient()
  const cart = useCart(ownSession?.id ?? null)
  const [checkoutStep, setCheckoutStep] = useState<"METHODS" | PaymentMethod | null>(null)
  const [completedSale, setCompletedSale] = useState<ReceiptView | null>(null)
  const [weighedProduct, setWeighedProduct] = useState<CatalogProduct | null>(null)
  const [isCartDialogOpen, setIsCartDialogOpen] = useState(false)
  const [lastPaymentMethod, setLastPaymentMethod] = useState<PaymentMethod | null>(
    getLastPaymentMethod,
  )
  const catalog = useProductCatalog(selectedRegister?.store_id ?? null)
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

  // Lue depuis Dexie au moment du submit, jamais depuis un cache React Query
  // potentiellement figé : c'était la cause de la « première vente hors
  // ligne » rejetée avec « Aucune session de caisse locale disponible ».
  async function resolveCheckoutSession(): Promise<LocalCashSession> {
    if (selectedRegister) {
      const stored = await getLocalCashSessionForRegister(selectedRegister.id)
      if (stored && stored.cashierId === user.id) return stored
      if (ownSession) return saveLocalCashSession(ownSession, selectedRegister, user)
    }
    if (localSession) return localSession
    throw new Error(
      "Aucune session de caisse disponible sur cet appareil. Reconnectez-vous pour rouvrir la caisse.",
    )
  }

  const saleMutation = useMutation({
    mutationFn: async (payment: CheckoutPayment): Promise<ReceiptView> => {
      // Encaissement local-first : la vente est durable dès que la
      // transaction Dexie (vente + stock + statut PENDING_SYNC) a committé.
      // La disponibilité du serveur n'entre jamais dans ce chemin — la
      // synchronisation est opportuniste, déclenchée après le succès, et son
      // échec ne peut pas transformer une vente enregistrée en erreur.
      const session = await resolveCheckoutSession()
      const sale = await createLocalSale({
        session,
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
      // Hors ligne, conserver la vente dans l’outbox et laisser le compteur
      // global refléter toutes les ventes en attente. La reconnexion déclenche
      // déjà une synchronisation groupée via SyncStatusProvider.
      if (isOnline) void triggerSync()
      trackSaleCompleted({
        sale_id: sale.id,
        store_id: selectedRegister?.store_id ?? null,
        cash_register_id: selectedRegister?.id ?? null,
        cash_session_id: ownSession?.id ?? null,
        payment_method: sale.payment.method,
        items_count: sale.items.length,
        total_amount: sale.total,
        offline: !isOnline,
      })
    },
    onError: (error, payment) => {
      // Seuls des échecs de persistance locale arrivent ici (stock local
      // insuffisant, produit absent du catalogue local, écriture IndexedDB) :
      // ils sont critiques et la vente n'est pas considérée comme terminée.
      if (
        error instanceof InsufficientLocalStockError ||
        error instanceof LocalSaleProductNotFoundError
      ) {
        void queryClient.invalidateQueries({ queryKey: ["products"] })
      }
      trackSaleFailed({
        error_code:
          error instanceof InsufficientLocalStockError
            ? "INSUFFICIENT_STOCK"
            : error instanceof LocalSaleProductNotFoundError
              ? "PRODUCT_NOT_FOUND"
              : "LOCAL_PERSIST_FAILED",
        payment_method: payment.method,
        offline: !isOnline,
      })
    },
  })

  function handleAddProduct(product: Parameters<typeof cart.addItem>[0]) {
    if (product.saleUnit === "KG") {
      setWeighedProduct(product)
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
      if (checkoutStep !== null || completedSale !== null || weighedProduct !== null || isCartDialogOpen) return
      if (!ownSession || cart.items.length === 0) return
      saleMutation.reset()
      setCheckoutStep(method)
      trackCheckoutOpened({ cart_items_count: cart.items.length, cart_total: cart.total })
      trackPaymentMethodSelected({ method })
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [checkoutStep, completedSale, weighedProduct, isCartDialogOpen, ownSession, cart.items.length, cart.total, saleMutation])

  return (
    <main className="pos-page">
      <header className="pos-heading">
        <div>
          <p className="eyebrow">Point de vente</p>
          <h1>{storeQuery.data?.name ?? localSession?.storeName ?? "Magasin"}</h1>
          <p className="pos-register-name">{selectedRegister?.name ?? "Caisse"}</p>
        </div>
      </header>

      {catalog.status === "catalogue_syncing" ? (
        <p className="muted" role="status">
          Préparation de la caisse — téléchargement du catalogue…
        </p>
      ) : null}
      {catalog.status === "catalogue_error" || catalog.status === "catalogue_not_initialized" ? (
        <div className="inline-error" role="alert">
          <strong>Catalogue indisponible hors ligne</strong>
          <p>Connectez cet appareil à Internet une première fois pour préparer le catalogue.</p>
          <button
            className="button button-secondary button-small"
            type="button"
            onClick={() => void catalog.retrySync()}
          >
            Réessayer
          </button>
        </div>
      ) : null}

      {selectedRegister ? (
        <div className="pos-grid">
          {catalog.status !== "catalogue_error" && catalog.status !== "catalogue_not_initialized" ? (
            <ProductSearch
              storeId={selectedRegister.store_id}
              onProductSelect={handleAddProduct}
            />
          ) : <div />}
          <Cart
            items={cart.items}
            total={cart.total}
            onIncrement={cart.incrementItem}
            onDecrement={cart.decrementItem}
            onQuantityChange={cart.setItemQuantity}
            onPriceChange={cart.setItemPrice}
            onRemove={cart.removeItem}
            onClear={cart.clearCart}
            onDialogOpenChange={setIsCartDialogOpen}
            onInteractionComplete={focusProductSearch}
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
          errorMessage={getCheckoutErrorMessage(saleMutation.error)}
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
          errorMessage={getCheckoutErrorMessage(saleMutation.error)}
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
          cashSessionId={ownSession?.id}
          onPrintTicket={() => {
            setCompletedSale(null)
            focusProductSearch()
          }}
          onNewSale={() => {
            setCompletedSale(null)
            focusProductSearch()
          }}
        />
      ) : null}
      {weighedProduct ? (
        <QuantityDialog
          item={{
            name: weighedProduct.name,
            unitPrice: weighedProduct.sellingPrice,
            saleUnit: weighedProduct.saleUnit,
            stockMilli: weighedProduct.stockMilli,
            stock: weighedProduct.stock,
          }}
          quantityMilli={null}
          onClose={() => {
            setWeighedProduct(null)
            focusProductSearch()
          }}
          onApply={(quantityMilli) => {
            cart.addItem(weighedProduct, quantityMilli)
            setWeighedProduct(null)
            focusProductSearch()
          }}
        />
      ) : null}
    </main>
  )
}
