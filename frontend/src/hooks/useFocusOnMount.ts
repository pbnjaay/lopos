import { useEffect, useRef } from "react"

/**
 * Place le focus sur un élément au montage d'un écran. Utilisé après une
 * navigation qui conclut une opération (vente, retour, clôture) pour que le
 * clavier et les lecteurs d'écran repartent du résultat, pas du haut du
 * document.
 */
export function useFocusOnMount<T extends HTMLElement>() {
  const ref = useRef<T>(null)

  useEffect(() => {
    ref.current?.focus()
  }, [])

  return ref
}
