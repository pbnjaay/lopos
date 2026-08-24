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

export type CashSessionSummary = {
  id: string
  status: "OPEN" | "CLOSED"
  cash_register: {
    id: string
    name: string
  }
  cashier: {
    id: number
    username: string
  }
  opened_at: string
  sales_count: number
  gross_sales: string
  returns_total?: string
  net_sales?: string
  payments: {
    cash: string
    wave: string
    orange_money: string
  }
  refunds?: {
    cash: string
    wave: string
    orange_money: string
  }
  opening_balance: string
  expected_cash: string
  counted_cash: string | null
  cash_difference: string | null
  closed_at: string | null
}

export type Product = {
  id: string
  name: string
  barcode: string | null
  selling_price: string
  purchase_price: string | null
  is_active: boolean
  sale_unit?: "UNIT" | "KG"
  stock: string | number
  created_at: string
  updated_at: string
}

export type PaymentMethod = "CASH" | "WAVE" | "ORANGE_MONEY"

export type CompleteSaleInput = {
  cash_session_id: string
  items: Array<{
    product_id: string
    quantity: string | number
    unit_price?: string
  }>
  payment: {
    method: PaymentMethod
    received_amount?: string
  }
}

export type SaleResponse = {
  id: string
  status: "COMPLETED"
  subtotal: string
  discount: string
  total: string
  returned_total?: string
  net_total?: string
  payment: {
    method: PaymentMethod
    amount: string
    received_amount: string | null
    change_amount: string | null
  }
  items: Array<{
    product_id: string
    id: string
    product_name: string
    sale_unit?: "UNIT" | "KG"
    catalog_unit_price?: string
    unit_price: string
    quantity: string | number
    line_total: string
    quantity_returned?: string
    quantity_returnable?: string
  }>
  created_at: string
}

export type SaleReceipt = SaleResponse & {
  store: {
    id: string
    name: string
  }
  cash_register: {
    id: string
    name: string
  }
  cashier: {
    id: number
    username: string
  }
}

export type SaleReturn = {
  id: string
  reference: string
  original_sale_id: string
  total_refund: string
  payment_method: PaymentMethod
  status: "COMPLETED"
  created_at: string
  items: Array<{ id: string; product_name: string; sale_unit: "UNIT" | "KG"; quantity: string; unit_price: string; refund_amount: string; restock: boolean }>
}
