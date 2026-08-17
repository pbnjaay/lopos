export type CatalogProduct = {
  id: string
  name: string
  barcode: string | null
  sellingPrice: number
  stock: number
  isActive: boolean
}
