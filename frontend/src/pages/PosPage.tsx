import { useEffect, useState } from "react"
import { useQuery } from "@tanstack/react-query"

import { getStore } from "../api/stores"
import { useCurrentUser } from "../features/auth/queries"
import { Cart } from "../features/cart/Cart"
import { useCart } from "../features/cart/useCart"
import { usePosSession } from "../features/cash-session/queries"
import { CashPaymentModal } from "../features/checkout/CashPaymentModal"
import { ProductSearch } from "../features/products/ProductSearch"
import { formatMoney } from "../utils/money"

export function PosPage() {
  const user = useCurrentUser().data!
  const { ownSession, selectedRegister } = usePosSession(user.id)
  const cart = useCart()
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false)
  const [preparedPayment, setPreparedPayment] = useState<{
    receivedAmount: number
    changeAmount: number
  } | null>(null)
  const storeQuery = useQuery({
    queryKey: ["stores", selectedRegister?.store_id],
    queryFn: () => getStore(selectedRegister!.store_id),
    enabled: selectedRegister !== null,
    staleTime: 60_000,
  })

  useEffect(() => {
    setPreparedPayment(null)
  }, [cart.items])

  function handleAddProduct(product: Parameters<typeof cart.addItem>[0]) {
    setPreparedPayment(null)
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
            onCheckout={() => setIsCheckoutOpen(true)}
          />
        </div>
      ) : (
        <p className="form-error" role="alert">
          Impossible de déterminer le magasin de cette caisse.
        </p>
      )}
      {preparedPayment ? (
        <p className="checkout-ready" role="status">
          Paiement CASH préparé : reçu {formatMoney(preparedPayment.receivedAmount)}, monnaie {" "}
          {formatMoney(preparedPayment.changeAmount)}. La vente n’est pas encore envoyée.
        </p>
      ) : null}
      {isCheckoutOpen ? (
        <CashPaymentModal
          total={cart.total}
          onClose={() => setIsCheckoutOpen(false)}
          onConfirm={(receivedAmount) => {
            setPreparedPayment({
              receivedAmount,
              changeAmount: receivedAmount - cart.total,
            })
            setIsCheckoutOpen(false)
          }}
        />
      ) : null}
    </main>
  )
}
