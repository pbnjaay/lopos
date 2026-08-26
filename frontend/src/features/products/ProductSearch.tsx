import { type FormEvent, type KeyboardEvent, useCallback, useEffect, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"

import { useDebouncedValue } from "../../hooks/useDebouncedValue"
import { Button } from "../../components/ui/Button"
import { EmptyState } from "../../components/ui/EmptyState"
import { InlineAlert } from "../../components/ui/InlineAlert"
import { Money } from "../../components/ui/Money"
import { SectionHeader } from "../../components/ui/SectionHeader"
import { Skeleton } from "../../components/ui/Skeleton"
import { BarcodeIcon } from "../../components/ui/Icons"
import { describeErrorShort } from "../../utils/errorCopy"
import { getProductByBarcode, searchProducts } from "./productService"
import type { CatalogProduct } from "./types"
import { formatQuantity } from "../../utils/quantity"

type ProductSearchProps = {
  storeId: string
  onProductSelect: (product: CatalogProduct) => void
}

export function ProductSearch({ storeId, onProductSelect }: ProductSearchProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [input, setInput] = useState("")
  const [barcode, setBarcode] = useState<string | null>(null)
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const debouncedSearch = useDebouncedValue(input.trim(), 250)
  const mode = barcode === null ? "search" : "barcode"
  const term = barcode ?? (input.trim() ? debouncedSearch : "")
  const productsQuery = useQuery({
    queryKey: ["products", storeId, mode, term],
    queryFn: async () => {
      if (mode === "search") return searchProducts(storeId, term)
      const product = await getProductByBarcode(storeId, term)
      return product ? [product] : []
    },
    enabled: term.length > 0,
    retry: false,
  })
  const products = (productsQuery.data ?? []).slice(0, 8)
  const stockMilli = (product: CatalogProduct) => product.stockMilli ?? (product.stock ?? 0) * 1000

  useEffect(() => {
    setHighlightedIndex(0)
  }, [productsQuery.data])

  function handleChange(value: string) {
    setInput(value)
    setBarcode(null)
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const scannedBarcode = input.trim()
    if (scannedBarcode) setBarcode(scannedBarcode)
  }

  const handleProductSelect = useCallback(
    (product: CatalogProduct) => {
      onProductSelect(product)
      setInput("")
      setBarcode(null)
      inputRef.current?.focus()
    },
    [onProductSelect],
  )

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    // Only take over Enter/arrows once name-search results are showing.
    // Otherwise let the form submit as before (barcode scan/lookup) — a
    // real barcode scanner types faster than the search debounce, so
    // `products` is still empty when its Enter arrives.
    if (mode !== "search" || products.length === 0) return

    if (event.key === "ArrowDown") {
      event.preventDefault()
      setHighlightedIndex((index) => Math.min(index + 1, products.length - 1))
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      setHighlightedIndex((index) => Math.max(index - 1, 0))
    } else if (event.key === "Enter") {
      event.preventDefault()
      const product = products[highlightedIndex] ?? products[0]
      if (product && stockMilli(product) > 0) handleProductSelect(product)
    }
  }

  useEffect(() => {
    if (barcode === null || productsQuery.isFetching) return
    const exactProduct = productsQuery.data?.[0]
    if (
      productsQuery.data?.length === 1 &&
      exactProduct?.barcode === barcode &&
      stockMilli(exactProduct) > 0
    ) {
      handleProductSelect(exactProduct)
    }
  }, [barcode, handleProductSelect, productsQuery.data, productsQuery.isFetching])

  return (
    <section className="product-search" aria-labelledby="product-search-title">
      <SectionHeader eyebrow="Catalogue" title="Rechercher un produit" titleId="product-search-title" />

      <form role="search" onSubmit={handleSubmit}>
        <label className="visually-hidden" htmlFor="product-search-input">
          Scanner un code-barres ou rechercher par nom
        </label>
        <input
          ref={inputRef}
          id="product-search-input"
          autoComplete="off"
          autoFocus
          enterKeyHint="done"
          placeholder="Scanner ou rechercher un produit"
          value={input}
          onChange={(event) => handleChange(event.target.value)}
          onKeyDown={handleKeyDown}
        />
        <Button variant="secondary" size="lg" type="submit" disabled={!input.trim()}>
          <BarcodeIcon />
          Chercher le code
        </Button>
      </form>

      <p className="search-hint">
        Saisissez un nom (flèches + Entrée pour valider), ou scannez un code-barres.
      </p>

      <div className="search-results" aria-live="polite">
        {/* Squelettes plutôt qu'un « Recherche… » : la structure des
            résultats reste en place, sans clignotement. */}
        {productsQuery.isFetching ? (
          <div className="product-list" aria-hidden="true">
            {[0, 1, 2].map((index) => (
              <span className="product-result product-result-skeleton" key={index}>
                <Skeleton width="45%" height="0.95rem" />
                <Skeleton width="5.5rem" height="0.95rem" />
              </span>
            ))}
          </div>
        ) : null}
        {productsQuery.error ? (
          <InlineAlert
            tone="warning"
            title="Recherche indisponible"
            action={
              <Button variant="secondary" size="sm" onClick={() => void productsQuery.refetch()}>
                Réessayer
              </Button>
            }
          >
            {describeErrorShort(productsQuery.error, "catalogue")}
          </InlineAlert>
        ) : null}
        {!productsQuery.isFetching && !productsQuery.error && term && products.length === 0 ? (
          <EmptyState
            compact
            title="Aucun produit trouvé."
            description="Vérifiez le nom saisi ou scannez le code-barres de l’article."
          />
        ) : null}
        {!productsQuery.isFetching && !productsQuery.error && products.length > 0 ? (
          <ul className="product-list">
            {products.map((product, index) => (
              <li key={product.id}>
                <button
                  className={
                    mode === "search" && index === highlightedIndex
                      ? "product-result product-result-highlighted"
                      : "product-result"
                  }
                  type="button"
                  // Surlignage purement visuel : `aria-current` annoncerait
                  // « élément courant » alors que rien n'est encore choisi.
                  // Le conteneur de résultats porte déjà `aria-live`.
                  data-highlighted={
                    mode === "search" && index === highlightedIndex ? "true" : undefined
                  }
                  disabled={stockMilli(product) <= 0}
                  aria-label={
                    stockMilli(product) > 0
                      ? `Ajouter ${product.name} au panier`
                      : `${product.name} en rupture de stock`
                  }
                  onMouseEnter={() => setHighlightedIndex(index)}
                  onClick={() => handleProductSelect(product)}
                >
                  <div>
                    <strong>{product.name}</strong>
                    <span>
                      {product.barcode ? `Code : ${product.barcode}` : "Sans code-barres"}
                    </span>
                  </div>
                  <div className="product-numbers">
                    <strong><Money value={product.sellingPrice} /></strong>
                    <span className={stockMilli(product) === 0 ? "stock-empty" : undefined}>
                      Stock : {formatQuantity(stockMilli(product), product.saleUnit ?? "UNIT")}
                    </span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {!term && !productsQuery.isFetching ? (
          <p className="empty-search">Les résultats apparaîtront ici.</p>
        ) : null}
      </div>
    </section>
  )
}
