import { useCurrentUser } from "../features/auth/queries"
import { usePosSession } from "../features/cash-session/queries"
import { ProductSearch } from "../features/products/ProductSearch"

export function PosPage() {
  const user = useCurrentUser().data!
  const { ownSession, selectedRegister } = usePosSession(user.id)

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
        <ProductSearch storeId={selectedRegister.store_id} />
      ) : (
        <p className="form-error" role="alert">
          Impossible de déterminer le magasin de cette caisse.
        </p>
      )}
    </main>
  )
}
