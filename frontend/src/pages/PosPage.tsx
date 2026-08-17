import { useCurrentUser } from "../features/auth/queries"
import { Cart } from "../features/cart/Cart"
import { useCart } from "../features/cart/useCart"
import { usePosSession } from "../features/cash-session/queries"
import { ProductSearch } from "../features/products/ProductSearch"

export function PosPage() {
  const user = useCurrentUser().data!
  const { ownSession, selectedRegister } = usePosSession(user.id)
  const cart = useCart()

  return (
    <main className="pos-page">
      <header className="pos-heading">
        <div>
          <p className="eyebrow">Session ouverte</p>
          <h1>{selectedRegister?.name ?? "Point de vente"}</h1>
        </div>
        <span className="session-badge">{ownSession?.status}</span>
      </header>

      {selectedRegister ? (
        <div className="pos-grid">
          <ProductSearch
            storeId={selectedRegister.store_id}
            onProductSelect={cart.addItem}
          />
          <Cart
            items={cart.items}
            total={cart.total}
            onIncrement={cart.incrementItem}
            onDecrement={cart.decrementItem}
            onQuantityChange={cart.setItemQuantity}
            onRemove={cart.removeItem}
            onClear={cart.clearCart}
          />
        </div>
      ) : (
        <p className="form-error" role="alert">
          Impossible de déterminer le magasin de cette caisse.
        </p>
      )}
    </main>
  )
}
