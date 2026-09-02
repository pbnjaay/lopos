import { useEffect, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { getStore } from "../api/stores"
import { Button } from "../components/ui/Button"
import { ErrorState } from "../components/ui/ErrorState"
import { InlineAlert } from "../components/ui/InlineAlert"
import { useToast } from "../components/ui/Toast"
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
import {
  HeldCartsDialog,
  type HeldCartAction,
  type ResumeStrategy,
} from "../features/cart/HeldCartsPanel"
import { HeldCartsSection } from "../features/cart/HeldCartsSection"
import { usePosSession } from "../features/cash-session/queries"
import { CashPaymentModal } from "../features/checkout/CashPaymentModal"
import { MobileMoneyConfirmation } from "../features/checkout/MobileMoneyConfirmation"
import { PaymentMethodModal } from "../features/checkout/PaymentMethodModal"
import { getLastPaymentMethod, storeLastPaymentMethod } from "../features/checkout/paymentMethodStorage"
import { SaleSuccessModal } from "../features/checkout/SaleSuccessModal"
import { useNetworkStatus } from "../features/offline/useNetworkStatus"
import { pendingSalesCountQueryKey } from "../features/offline/usePendingSalesCount"
import { ProductGrid } from "../features/products/ProductGrid"
import { ProductSearch } from "../features/products/ProductSearch"
import { useProductCatalog } from "../features/products/queries"
import type { CatalogProduct } from "../features/products/types"
import { type ReceiptView, receiptViewFromLocalSale } from "../features/sales/receiptView"
import { useSyncStatus } from "../features/sync/useSyncStatus"
import type { PaymentMethod } from "../types/api"
import { formatQuantity } from "../utils/quantity"

type CheckoutPayment = {
  method: PaymentMethod
  receivedAmount?: number
}

const checkoutFKeyToMethod: Record<string, PaymentMethod> = {
  F1: "CASH",
  F2: "WAVE",
  F3: "ORANGE_MONEY",
}

// Erreur bloquante d'encaissement : seuls des échecs de persistance locale
// arrivent ici. Le message dit ce qui s'est passé et ce qu'il faut faire,
// jamais le nom de l'exception.
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
  const toast = useToast()
  const cart = useCart(ownSession?.id ?? null, selectedRegister?.store_id ?? null)
  const [checkoutStep, setCheckoutStep] = useState<"METHODS" | PaymentMethod | null>(null)
  const [completedSale, setCompletedSale] = useState<ReceiptView | null>(null)
  const [weighedProduct, setWeighedProduct] = useState<CatalogProduct | null>(null)
  const [isCartDialogOpen, setIsCartDialogOpen] = useState(false)
  const [isHeldCartsOpen, setIsHeldCartsOpen] = useState(false)
  const [heldCartAction, setHeldCartAction] = useState<HeldCartAction | null>(null)
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
    void updateLocalCashSessionStoreName(ownSession.id, storeQuery.data.name)
      // L'en-tête global lit ce nom depuis Dexie : sans invalidation il
      // resterait sur « Caisse 01 » seul jusqu'au prochain rechargement.
      .then(() => queryClient.invalidateQueries({ queryKey: ["local-cash-session"] }))
      .catch(() => undefined)
  }, [ownSession, queryClient, storeQuery.data])

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

  /**
   * Ajout depuis la grille du rail. Le focus doit repartir au champ de scan :
   * sinon il resterait sur la tuile, et la frappe du scanner — qui est un
   * clavier — arriverait sur un bouton au lieu du champ. On ne le fait pas
   * pour un article au poids, dont le dialogue de pesée prend le focus.
   */
  function handleGridSelect(product: Parameters<typeof cart.addItem>[0]) {
    handleAddProduct(product)
    if (product.saleUnit !== "KG") {
      document.getElementById("product-search-input")?.focus()
    }
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

  function handleSuspendCart() {
    void cart.holdCart()
    toast.success("Vente mise en attente")
    focusProductSearch()
  }

  function handleDeleteHeldCart(cartId: string) {
    void cart.deleteHeldCart(cartId)
    // Une suppression demandée depuis le rail n'avait qu'une confirmation à
    // obtenir : une fois donnée, on rend la main à la caisse plutôt que de
    // laisser une liste ouverte que personne n'a demandée.
    if (heldCartAction?.type === "delete") closeHeldCarts()
  }

  // Reprise depuis le rail : un panier vide reprend directement, un panier
  // en cours passe par l'arbitrage existant — jamais d'écrasement silencieux
  // de la vente commencée.
  function handleRailResume(cartId: string) {
    if (cart.items.length > 0) {
      setHeldCartAction({ type: "resume", cartId })
      setIsHeldCartsOpen(true)
      return
    }
    void handleResumeHeldCart(cartId, "direct")
  }

  // Supprimer reste destructif : le rail déclenche la confirmation, il ne
  // supprime jamais au clic.
  function handleRailDelete(cartId: string) {
    setHeldCartAction({ type: "delete", cartId })
    setIsHeldCartsOpen(true)
  }

  function closeHeldCarts() {
    setIsHeldCartsOpen(false)
    setHeldCartAction(null)
    focusProductSearch()
  }

  async function handleResumeHeldCart(cartId: string, strategy: ResumeStrategy) {
    setIsHeldCartsOpen(false)
    setHeldCartAction(null)
    if (strategy === "hold") await cart.holdCart()
    else if (strategy === "clear") await cart.clearCart()

    const revalidation = await cart.resumeCart(cartId)
    if (!revalidation) {
      toast.error("Impossible de reprendre ce panier", { description: "Réessayez." })
      return
    }

    if (revalidation.removed.length > 0 || revalidation.reduced.length > 0) {
      const adjustments = [
        ...revalidation.removed.map((name) => `${name} retiré (stock épuisé)`),
        ...revalidation.reduced.map(
          (change) => `${change.name} réduit à ${formatQuantity(change.toMilli, change.saleUnit)}`,
        ),
      ]
      toast.warning("Panier repris avec des ajustements", { description: adjustments.join(" · ") })
    } else {
      toast.success("Panier repris")
    }
    focusProductSearch()
  }

  function closeCheckout() {
    setCheckoutStep(null)
    focusProductSearch()
  }

  /**
   * Entree dans l'encaissement pour un moyen de paiement donne — partagee
   * par les trois boutons du pied de panier et par F1/F2/F3, pour que les
   * deux chemins declenchent exactement la meme chose.
   */
  function startCheckout(method: PaymentMethod) {
    if (!ownSession || cart.items.length === 0) return
    saleMutation.reset()
    setCheckoutStep(method)
    trackCheckoutOpened({ cart_items_count: cart.items.length, cart_total: cart.total })
    trackPaymentMethodSelected({ method })
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
      if (
        checkoutStep !== null ||
        completedSale !== null ||
        weighedProduct !== null ||
        isCartDialogOpen ||
        isHeldCartsOpen
      )
        return
      startCheckout(method)
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [
    checkoutStep,
    completedSale,
    weighedProduct,
    isCartDialogOpen,
    isHeldCartsOpen,
    ownSession,
    cart.items.length,
    cart.total,
    saleMutation,
  ])

  return (
    <main className="pos-page">
      <h1 className="visually-hidden">
        Point de vente — {storeQuery.data?.name ?? localSession?.storeName ?? "Magasin"},{" "}
        {selectedRegister?.name ?? "Caisse"}
      </h1>

      {catalog.status === "catalogue_syncing" ? (
        <InlineAlert className="pos-notice">
          Préparation de la caisse — téléchargement du catalogue…
        </InlineAlert>
      ) : null}
      {catalog.status === "catalogue_error" || catalog.status === "catalogue_not_initialized" ? (
        <InlineAlert
          className="pos-notice"
          tone="warning"
          assertive
          title="Catalogue indisponible hors ligne"
          action={
            <Button variant="secondary" size="sm" onClick={() => void catalog.retrySync()}>
              Réessayer
            </Button>
          }
        >
          Connectez cet appareil à Internet une première fois pour préparer le catalogue.
        </InlineAlert>
      ) : null}

      {selectedRegister ? (
        <div className="pos-grid">
          {catalog.status !== "catalogue_error" && catalog.status !== "catalogue_not_initialized" ? (
            <ProductSearch
              storeId={selectedRegister.store_id}
              onProductSelect={handleAddProduct}
              // Au repos, le rail travaille : ce qui attend le caissier y est
              // déjà, et reprendre un panier ou rouvrir un ticket ne demande
              // ni modale ni changement de page.
              restContent={
                <div className="pos-rail-rest">
                  <ProductGrid
                    storeId={selectedRegister.store_id}
                    onProductSelect={handleGridSelect}
                  />
                  <HeldCartsSection
                    carts={cart.heldCarts.list}
                    onResume={handleRailResume}
                    onDelete={handleRailDelete}
                    onSeeAll={() => setIsHeldCartsOpen(true)}
                  />
                </div>
              }
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
            onSuspend={handleSuspendCart}
            onDialogOpenChange={setIsCartDialogOpen}
            onInteractionComplete={focusProductSearch}
            lastUsedMethod={lastPaymentMethod}
            onCheckoutMethod={startCheckout}
          />
        </div>
      ) : (
        <ErrorState
          title="Caisse non rattachée à une boutique"
          description="Cette caisse n’est associée à aucune boutique. Contactez un responsable pour la reconfigurer."
        />
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
      {isHeldCartsOpen ? (
        <HeldCartsDialog
          carts={cart.heldCarts.list}
          activeItemCount={cart.items.length}
          initialAction={heldCartAction}
          onClose={closeHeldCarts}
          onResume={(cartId, strategy) => void handleResumeHeldCart(cartId, strategy)}
          onDelete={handleDeleteHeldCart}
        />
      ) : null}
    </main>
  )
}
