import { type FormEvent, useCallback, useEffect, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"

import { getProducts } from "../../api/products"
import { useDebouncedValue } from "../../hooks/useDebouncedValue"
import { formatMoney } from "../../utils/money"
import type { Product } from "../../types/api"

type ProductSearchProps = {
  storeId: string
  onProductSelect: (product: Product) => void
}

export function ProductSearch({ storeId, onProductSelect }: ProductSearchProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [input, setInput] = useState("")
  const [barcode, setBarcode] = useState<string | null>(null)
  const debouncedSearch = useDebouncedValue(input.trim(), 250)
  const mode = barcode === null ? "search" : "barcode"
  const term = barcode ?? (input.trim() ? debouncedSearch : "")
  const productsQuery = useQuery({
    queryKey: ["products", storeId, mode, term],
    queryFn: () =>
      mode === "barcode"
        ? getProducts({ storeId, barcode: term })
        : getProducts({ storeId, search: term }),
    enabled: term.length > 0,
    retry: false,
  })
  const products = (productsQuery.data ?? []).slice(0, 8)

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
    (product: Product) => {
      onProductSelect(product)
      setInput("")
      setBarcode(null)
      inputRef.current?.focus()
    },
    [onProductSelect],
  )

  useEffect(() => {
    if (barcode === null || productsQuery.isFetching) return
    const exactProduct = productsQuery.data?.[0]
    if (
      productsQuery.data?.length === 1 &&
      exactProduct?.barcode === barcode &&
      exactProduct.stock > 0
    ) {
      handleProductSelect(exactProduct)
    }
  }, [barcode, handleProductSelect, productsQuery.data, productsQuery.isFetching])

  return (
    <section className="product-search" aria-labelledby="product-search-title">
      <div>
        <p className="eyebrow">Catalogue</p>
        <h2 id="product-search-title">Rechercher un produit</h2>
      </div>

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
        />
        <button className="button button-secondary" type="submit" disabled={!input.trim()}>
          Code-barres
        </button>
      </form>

      <p className="search-hint">
        Saisissez un nom, ou scannez un code-barres puis appuyez sur Entrée.
      </p>

      <div className="search-results" aria-live="polite">
        {productsQuery.isFetching ? <p>Recherche…</p> : null}
        {productsQuery.error ? (
          <div className="inline-error" role="alert">
            <p>{productsQuery.error.message}</p>
            <button
              className="button button-secondary button-small"
              type="button"
              onClick={() => void productsQuery.refetch()}
            >
              Réessayer
            </button>
          </div>
        ) : null}
        {!productsQuery.isFetching && !productsQuery.error && term && products.length === 0 ? (
          <p>Aucun produit trouvé.</p>
        ) : null}
        {!productsQuery.isFetching && !productsQuery.error && products.length > 0 ? (
          <ul className="product-list">
            {products.map((product) => (
              <li key={product.id}>
                <button
                  className="product-result"
                  type="button"
                  disabled={product.stock <= 0}
                  aria-label={
                    product.stock > 0
                      ? `Ajouter ${product.name} au panier`
                      : `${product.name} en rupture de stock`
                  }
                  onClick={() => handleProductSelect(product)}
                >
                  <div>
                    <strong>{product.name}</strong>
                    <span>
                      {product.barcode ? `Code : ${product.barcode}` : "Sans code-barres"}
                    </span>
                  </div>
                  <div className="product-numbers">
                    <strong>{formatMoney(Number(product.selling_price))}</strong>
                    <span className={product.stock === 0 ? "stock-empty" : undefined}>
                      Stock : {product.stock}
                    </span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {!term ? <p className="empty-search">Les résultats apparaîtront ici.</p> : null}
      </div>
    </section>
  )
}
