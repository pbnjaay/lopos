import { useState } from "react"
import { useQuery } from "@tanstack/react-query"

import { getStore } from "../api/stores"
import { useCurrentUser } from "../features/auth/queries"
import { Cart } from "../features/cart/Cart"
import { useCart } from "../features/cart/useCart"
import { usePosSession } from "../features/cash-session/queries"
import { ProductSearch } from "../features/products/ProductSearch"

export function PosPage() {
  const user = useCurrentUser().data!
  const { ownSession, selectedRegister } = usePosSession(user.id)
  const cart = useCart()
  const [checkoutRequested, setCheckoutRequested] = useState(false)
  const storeQuery = useQuery({
    queryKey: ["stores", selectedRegister?.store_id],
    queryFn: () => getStore(selectedRegister!.store_id),
    enabled: selectedRegister !== null,
    staleTime: 60_000,
  })

  function handleAddProduct(product: Parameters<typeof cart.addItem>[0]) {
    setCheckoutRequested(false)
    cart.addItem(product)
  }

  return (
    <main className="pos-page">
      <header className="pos-heading">
        <div>
          <p className="eyebrow">Point de vente</p>
          <h1>{storeQuery.data?.name ?? "Magasin"}</h1>
          <p className="pos-register-name">{selectedRegister?.name ?? "Caisse"}</p>
        </div>
        <div className="session-summary">
          <span className="session-badge">Session {ownSession?.status}</span>
          <span>Caissier : {user.first_name || user.username}</span>
        </div>
      </header>

      {storeQuery.error ? (
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
            onCheckout={() => setCheckoutRequested(true)}
          />
        </div>
      ) : (
        <p className="form-error" role="alert">
          Impossible de déterminer le magasin de cette caisse.
        </p>
      )}
      {checkoutRequested ? (
        <p className="checkout-ready" role="status">
          Panier prêt à encaisser. Le paiement CASH arrive à l’étape 7.
        </p>
      ) : null}
    </main>
  )
}
