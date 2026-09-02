import { useQuery } from "@tanstack/react-query"

import { EmptyState } from "../../components/ui/EmptyState"
import { Money } from "../../components/ui/Money"
import { Skeleton } from "../../components/ui/Skeleton"
import { formatQuantity } from "../../utils/quantity"
import { listTopProducts } from "./productService"
import type { CatalogProduct } from "./types"

/** Aligné sur LOW_STOCK_THRESHOLD_DEFAULT côté back-office. */
const LOW_STOCK_THRESHOLD_MILLI = 5000

/**
 * Un caissier ne balaie pas cent vignettes : au-delà, c'est le scanner ou la
 * recherche qui sont plus rapides. On plafonne donc la grille aux meilleures
 * ventes — le reste du catalogue reste atteignable par le champ de recherche.
 */
const GRID_SIZE = 18

type ProductGridProps = {
  storeId: string
  onProductSelect: (product: CatalogProduct) => void
}

function stockMilliOf(product: CatalogProduct): number {
  return product.stockMilli ?? (product.stock ?? 0) * 1000
}

export function productGridQueryKey(storeId: string) {
  return ["product-grid", storeId, GRID_SIZE] as const
}

/**
 * Les meilleures ventes du magasin, en tuiles, dans le rail au repos.
 *
 * Sans photo produit — le modèle n'en porte pas — la tuile s'appuie sur le
 * nom et le prix, et c'est un choix, pas un pis-aller : deux « Lait en poudre
 * 400g » à 1 600 et 2 200 FCFA sont indiscernables en image et évidents en
 * texte.
 *
 * Le classement décide *quels* produits apparaissent ; l'affichage reste
 * alphabétique pour que la position d'une tuile ne bouge pas d'un jour à
 * l'autre — c'est elle qui remplace l'image dans l'œil du caissier.
 */
export function ProductGrid({ storeId, onProductSelect }: ProductGridProps) {
  const productsQuery = useQuery({
    queryKey: productGridQueryKey(storeId),
    queryFn: () => listTopProducts(storeId, GRID_SIZE),
    staleTime: 5 * 60_000,
  })

  if (productsQuery.isPending) {
    return (
      <div className="product-grid" aria-hidden="true">
        {Array.from({ length: 8 }, (_, index) => index).map((index) => (
          <span className="product-tile product-tile-skeleton" key={index}>
            <Skeleton width="80%" height="0.9rem" />
            <Skeleton width="50%" height="0.9rem" />
          </span>
        ))}
      </div>
    )
  }

  // Une grille absente n'est pas une panne : la recherche et le scanner
  // fonctionnent toujours. On reste donc silencieux plutôt que d'occuper le
  // rail avec une alerte que le caissier ne peut pas résoudre en caisse.
  if (productsQuery.error) return null

  const products = productsQuery.data ?? []
  if (products.length === 0) {
    return (
      <EmptyState
        compact
        title="Aucun produit au catalogue."
        description="Ajoutez des produits depuis l’administration pour les retrouver ici."
      />
    )
  }

  return (
    <div className="product-grid">
      {products.map((product) => {
        const stock = stockMilliOf(product)
        const unit = product.saleUnit ?? "UNIT"
        const isOut = stock <= 0
        const isLow = !isOut && stock <= LOW_STOCK_THRESHOLD_MILLI
        return (
          <button
            className="product-tile"
            key={product.id}
            type="button"
            disabled={isOut}
            aria-label={
              isOut
                ? `${product.name} en rupture de stock`
                : `Ajouter ${product.name} au panier`
            }
            onClick={() => onProductSelect(product)}
          >
            <span className="product-tile-name">{product.name}</span>
            <span className="product-tile-foot">
              {/* En rupture, la mention remplace le prix au lieu de se battre
                  avec lui pour la largeur : l'article n'est pas vendable, son
                  prix n'a plus rien a dire. Toutes les tuiles gardent ainsi la
                  meme hauteur, quel que soit leur etat. */}
              {isOut ? (
                <strong className="product-tile-stock-out">Rupture</strong>
              ) : (
                <>
                  <strong>
                    <Money value={product.sellingPrice} />
                  </strong>
                  {isLow ? (
                    <span className="product-tile-stock product-tile-stock-low">
                      {formatQuantity(stock, unit)}
                    </span>
                  ) : unit === "KG" ? (
                    // « unité » est le cas par défaut : l'afficher partout
                    // n'ajoutait rien et disputait sa place au prix.
                    <span className="product-tile-unit">au kg</span>
                  ) : null}
                </>
              )}
            </span>
          </button>
        )
      })}
    </div>
  )
}
