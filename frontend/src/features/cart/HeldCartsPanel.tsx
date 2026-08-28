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

function cartLabel(cart: LocalCart): string {
  const count = cart.items.length
  return `${count} article${count > 1 ? "s" : ""}`
}

export function HeldCartsDialog({ carts, activeItemCount, onClose, onResume, onDelete }: HeldCartsDialogProps) {
  const [resumeTarget, setResumeTarget] = useState<LocalCart | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<LocalCart | null>(null)
  const cancelResumeRef = useRef<HTMLButtonElement>(null)
  const cancelDeleteRef = useRef<HTMLButtonElement>(null)

  function requestResume(cart: LocalCart) {
    if (activeItemCount > 0) {
      setResumeTarget(cart)
      return
    }
    onResume(cart.id, "direct")
  }

  return (
    <>
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
                        onClick={() => setDeleteTarget(cart)}
                      />
                    </>
                  }
                />
              ))}
            </div>
          )}
        </DialogBody>
      </Dialog>

      {resumeTarget ? (
        <Dialog
          eyebrow="Vente en cours"
          title="Panier actuel non vide"
          size="sm"
          initialFocusRef={cancelResumeRef}
          onClose={() => setResumeTarget(null)}
        >
          <DialogBody>
            <p>
              La vente en cours contient {activeItemCount} article{activeItemCount > 1 ? "s" : ""}.
              Mettez-la en attente ou videz-la avant de reprendre ce panier.
            </p>
            <DialogFooter>
              <Button ref={cancelResumeRef} variant="secondary" onClick={() => setResumeTarget(null)}>
                Annuler
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  onResume(resumeTarget.id, "clear")
                  setResumeTarget(null)
                }}
              >
                Vider et reprendre
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  onResume(resumeTarget.id, "hold")
                  setResumeTarget(null)
                }}
              >
                Mettre en attente et reprendre
              </Button>
            </DialogFooter>
          </DialogBody>
        </Dialog>
      ) : null}

      {deleteTarget ? (
        <Dialog
          eyebrow="Panier en attente"
          title="Supprimer ce panier ?"
          size="sm"
          initialFocusRef={cancelDeleteRef}
          onClose={() => setDeleteTarget(null)}
        >
          <DialogBody>
            <p>
              Les {cartLabel(deleteTarget)} de ce panier seront définitivement perdus.
            </p>
            <DialogFooter>
              <Button ref={cancelDeleteRef} variant="secondary" onClick={() => setDeleteTarget(null)}>
                Annuler
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  onDelete(deleteTarget.id)
                  setDeleteTarget(null)
                }}
              >
                Supprimer le panier
              </Button>
            </DialogFooter>
          </DialogBody>
        </Dialog>
      ) : null}
    </>
  )
}
