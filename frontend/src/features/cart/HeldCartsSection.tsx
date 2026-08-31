import { Button } from "../../components/ui/Button"
import { IconButton } from "../../components/ui/IconButton"
import { Money } from "../../components/ui/Money"
import { PlayIcon, TrashIcon } from "../../components/ui/Icons"
import type { LocalCart } from "../../db/types"
import { formatTime } from "../../utils/date"
import { getCartTotal } from "./cartState"

const VISIBLE_CARTS = 3

type HeldCartsSectionProps = {
  carts: LocalCart[]
  onResume: (cartId: string) => void
  onDelete: (cartId: string) => void
  onSeeAll: () => void
}

/**
 * Paniers en attente, listés à même le POS. Le workflow visé est
 * « suspendre → servir un autre client → reprendre » : suspendre coûte un
 * clic, reprendre doit en coûter un aussi. La modale ne sert plus qu'au
 * débordement et à la suppression, qui est destructive et rare.
 */
export function HeldCartsSection({
  carts,
  onResume,
  onDelete,
  onSeeAll,
}: HeldCartsSectionProps) {
  if (carts.length === 0) return null
  const visible = carts.slice(0, VISIBLE_CARTS)

  return (
    <section className="pos-rail-section" aria-labelledby="held-carts-title">
      <div className="pos-rail-section-header">
        <h2 id="held-carts-title">
          Paniers en attente <span className="pos-rail-count">{carts.length}</span>
        </h2>
        {carts.length > VISIBLE_CARTS ? (
          <button className="pos-rail-link" type="button" onClick={onSeeAll}>
            Tous
          </button>
        ) : null}
      </div>
      {/* Un panier suspendu garde sa presence — c'est un travail en cours,
          pas une trace — mais son interieur tient en deux rangees :
          identite + montant, puis les deux actions. */}
      <ul className="pos-rail-list">
        {visible.map((cart) => {
          const label = `${cart.items.length} article${cart.items.length > 1 ? "s" : ""}`
          return (
            <li key={cart.id} className="pos-rail-card">
              <div className="pos-rail-card-head">
                <span>
                  {label}
                  {cart.heldAt ? ` · ${formatTime(cart.heldAt)}` : ""}
                </span>
                <strong>
                  <Money value={getCartTotal(cart.items)} />
                </strong>
              </div>
              <div className="pos-rail-card-actions">
                <Button
                  variant="secondary"
                  size="sm"
                  aria-label={`Reprendre le panier de ${label}`}
                  onClick={() => onResume(cart.id)}
                >
                  <PlayIcon />
                  Reprendre
                </Button>
                <IconButton
                  label={`Supprimer le panier en attente de ${label}`}
                  title="Supprimer ce panier"
                  icon={<TrashIcon />}
                  tone="danger"
                  onClick={() => onDelete(cart.id)}
                />
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
