export type CatalogProduct = {
  id: string
  name: string
  barcode: string | null
  sellingPrice: number
  saleUnit?: "UNIT" | "KG"
  stockMilli?: number
  stock?: number
  isActive: boolean
}
