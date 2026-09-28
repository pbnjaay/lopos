import { type KeyboardEvent, useEffect, useState } from "react"

type ListNavigationOptions<T> = {
  /** Ouvre l'élément visé (Entrée). */
  onOpen: (item: T) => void
  /**
   * Résultats en retard sur la saisie (debounce en cours, requête en vol) :
   * ouvrir la ligne visée ouvrirait un élément que le caissier n'a plus
   * demandé. Entrée ne fait alors rien.
   */
  isStale?: boolean
  /** Change quand la liste change de sens (nouvelle recherche, filtre) : la visée repart en tête. */
  resetKey?: unknown
}

/**
 * Navigation clavier d'une page de liste, identique partout : le focus reste
 * dans le champ de recherche, les flèches déplacent la ligne visée, Entrée
 * l'ouvre — comme dans le catalogue du point de vente.
 */
export function useListNavigation<T>(items: readonly T[], { onOpen, isStale = false, resetKey }: ListNavigationOptions<T>) {
  const [highlightedIndex, setHighlightedIndex] = useState(0)

  useEffect(() => {
    setHighlightedIndex(0)
  }, [resetKey])

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (items.length === 0) return
    if (event.key === "ArrowDown") {
      event.preventDefault()
      setHighlightedIndex((index) => Math.min(index + 1, items.length - 1))
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      setHighlightedIndex((index) => Math.max(index - 1, 0))
    } else if (event.key === "Enter") {
      event.preventDefault()
      const item = items[highlightedIndex]
      if (!isStale && item !== undefined) onOpen(item)
    }
  }

  return {
    highlightedIndex,
    setHighlightedIndex,
    aimedItem: items[highlightedIndex] ?? null,
    handleKeyDown,
  }
}
