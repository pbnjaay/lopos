export type CurrentUser = {
  id: number
  username: string
  email: string
  first_name: string
  last_name: string
  is_staff: boolean
}

export type Store = {
  id: string
  name: string
  address: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export type CashRegister = {
  id: string
  store_id: string
  name: string
  is_active: boolean
  created_at: string
  updated_at: string
}

export type CashSession = {
  id: string
  cash_register_id: string
  cashier_id: number
  opening_balance: string
  status: "OPEN" | "CLOSED"
  opened_at: string
  closing_balance: string | null
  expected_balance: string | null
  difference: string | null
  closed_at: string | null
}

export type Product = {
  id: string
  name: string
  barcode: string | null
  selling_price: string
  purchase_price: string | null
  is_active: boolean
  stock: number
  created_at: string
  updated_at: string
}
