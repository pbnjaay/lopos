import { useRef, useState } from "react"

import { Button } from "../../components/ui/Button"
import { Dialog, DialogBody, DialogFooter } from "../../components/ui/Dialog"
import { EmptyState } from "../../components/ui/EmptyState"
import { IconButton } from "../../components/ui/IconButton"
import { ListRow } from "../../components/ui/ListRow"
import { Money } from "../../components/ui/Money"
import { PlayIcon, TrashIcon } from "../../components/ui/Icons"
import type { LocalCart } from "../../db/types"
import { formatTime } from "../../utils/date"
import { getCartTotal } from "./cartState"

export type ResumeStrategy = "direct" | "hold" | "clear"

type HeldCartsDialogProps = {
  carts: LocalCart[]
  activeItemCount: number
  onClose: () => void
  onResume: (cartId: string, strategy: ResumeStrategy) => void
  onDelete: (cartId: string) => void
}

type Step =
  | { name: "list" }
  | { name: "resume-confirm"; cart: LocalCart }
  | { name: "delete-confirm"; cart: LocalCart }

function cartLabel(cart: LocalCart): string {
  const count = cart.items.length
  return `${count} article${count > 1 ? "s" : ""}`
}

/**
 * Une seule modale à la fois, qui change d'étape — jamais deux `Dialog`
 * montés en même temps. Chacun installe son propre gestionnaire clavier sur
 * `window` ; en empiler deux fait que le premier monté intercepte Échap avant
 * le second (`stopImmediatePropagation`). `onBack` est le mécanisme prévu par
 * `Dialog` pour un parcours à étapes : Échap recule d'un pas au lieu de tout
 * fermer.
 */
export function HeldCartsDialog({ carts, activeItemCount, onClose, onResume, onDelete }: HeldCartsDialogProps) {
  const [step, setStep] = useState<Step>({ name: "list" })
  const holdAndResumeRef = useRef<HTMLButtonElement>(null)
  const cancelDeleteRef = useRef<HTMLButtonElement>(null)

  function backToList() {
    setStep({ name: "list" })
  }

  function requestResume(cart: LocalCart) {
    if (activeItemCount > 0) {
      setStep({ name: "resume-confirm", cart })
      return
    }
    onResume(cart.id, "direct")
  }

  if (step.name === "resume-confirm") {
    const { cart } = step
    return (
      <Dialog
        eyebrow="Vente en cours"
        title="Panier actuel non vide"
        size="sm"
        onBack={backToList}
        // Ni l'un ni l'autre bouton n'est un « Annuler » — reculer (← / Échap)
        // couvre déjà ce cas, donc les deux vrais choix restent côte à côte
        // dans les deux seules colonnes du pied de modale.
        initialFocusRef={holdAndResumeRef}
        onClose={onClose}
      >
        <DialogBody>
          <p>
            La vente en cours contient {activeItemCount} article{activeItemCount > 1 ? "s" : ""}.
            Mettez-la en attente ou videz-la avant de reprendre ce panier.
          </p>
          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => {
                onResume(cart.id, "clear")
                backToList()
              }}
            >
              Vider et reprendre
            </Button>
            <Button
              ref={holdAndResumeRef}
              variant="primary"
              onClick={() => {
                onResume(cart.id, "hold")
                backToList()
              }}
            >
              Mettre en attente et reprendre
            </Button>
          </DialogFooter>
        </DialogBody>
      </Dialog>
    )
  }

  if (step.name === "delete-confirm") {
    const { cart } = step
    return (
      <Dialog
        eyebrow="Panier en attente"
        title="Supprimer ce panier ?"
        size="sm"
        onBack={backToList}
        initialFocusRef={cancelDeleteRef}
        onClose={onClose}
      >
        <DialogBody>
          <p>Les {cartLabel(cart)} de ce panier seront définitivement perdus.</p>
          <DialogFooter>
            <Button ref={cancelDeleteRef} variant="secondary" onClick={backToList}>
              Annuler
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                onDelete(cart.id)
                backToList()
              }}
            >
              Supprimer le panier
            </Button>
          </DialogFooter>
        </DialogBody>
      </Dialog>
    )
  }

  return (
    <Dialog eyebrow="Panier" title="Paniers en attente" onClose={onClose}>
      <DialogBody>
        {carts.length === 0 ? (
          <EmptyState
            compact
            title="Aucun panier en attente."
            description="Suspendez une vente en cours pour la retrouver ici."
          />
        ) : (
          <div className="held-carts-list">
            {carts.map((cart) => (
              <ListRow
                key={cart.id}
                title={cartLabel(cart)}
                meta={<Money value={getCartTotal(cart.items)} />}
                footnote={`Mis en attente à ${cart.heldAt ? formatTime(cart.heldAt) : "—"}`}
                trailing={
                  <>
                    <Button variant="secondary" size="sm" onClick={() => requestResume(cart)}>
                      <PlayIcon />
                      Reprendre
                    </Button>
                    <IconButton
                      label={`Supprimer le panier en attente (${cartLabel(cart)})`}
                      title="Supprimer ce panier"
                      icon={<TrashIcon />}
                      tone="danger"
                      onClick={() => setStep({ name: "delete-confirm", cart })}
                    />
                  </>
                }
              />
            ))}
          </div>
        )}
      </DialogBody>
    </Dialog>
  )
}
