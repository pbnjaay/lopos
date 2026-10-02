export type MemberRole = "OWNER" | "MANAGER" | "CASHIER"

export type CurrentUser = {
  id: number
  username: string
  email: string
  first_name: string
  last_name: string
  is_staff: boolean
  /** Commerce du compte, calculé par le serveur — jamais choisi par le poste. */
  organization: { id: string; name: string }
  role: MemberRole
  /** Magasins où le compte peut travailler. */
  store_ids: string[]
  can_view_costs: boolean
  /**
   * Ce qu'un gérant doit valider (PIN) pour ce compte. Absent d'un compte
   * reconstruit hors ligne avant cette version : voir `approvalPolicyFor`.
   */
  approval_policy?: ApprovalPolicy
}

export type ApprovalPolicy = {
  /** Faux pour un gérant ou un propriétaire : il valide lui-même. */
  required: boolean
  /** Montant (FCFA) à partir duquel annulation, retour ou remise exigent un gérant. */
  amount_threshold: string
  /** Taux de remise par ligne au-delà duquel un gérant doit valider (ex. "0.10"). */
  max_discount_rate: string
  return_window_days: number
}

export type ApprovalAction = "CANCEL_SALE" | "SALE_RETURN" | "DISCOUNT"

export type Approver = { id: number; name: string }

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
  /** Argent réellement rendu sur les retours, par moyen (hors part déduite du cahier). */
  refunds?: {
    cash: string
    wave: string
    orange_money: string
  }
  /** Part des ventes mise au cahier : pas de l'argent reçu. */
  credit_sales?: string
  /** Part des retours effacée du cahier : pas de l'argent rendu. */
  credit_returns?: string
  /** Paiements de clients sur leur cahier : de l'argent reçu, mais pas des ventes. */
  customer_payments?: {
    cash: string
    wave: string
    orange_money: string
  }
  /** Dépenses enregistrées de la session (hors annulées). */
  expenses_count?: number
  /** Dépenses par moyen : seules les espèces sortent du tiroir. */
  expenses?: {
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
  is_active: boolean
  sale_unit?: "UNIT" | "KG"
  stock: string | number
  created_at: string
  updated_at: string
}

/** Client du cahier, avec son solde dû calculé côté serveur. */
export type Customer = {
  id: string
  store_id: string
  name: string
  /** Format E.164 (+221771234567) ; null pour un client repris sans numéro. */
  phone: string | null
  is_active: boolean
  balance: string
  last_activity_at: string | null
  updated_at: string
}

export type PaymentMethod = "CASH" | "WAVE" | "ORANGE_MONEY"

export type LedgerEntryType =
  | "CREDIT_SALE"
  | "PAYMENT"
  | "RETURN_CREDIT"
  | "ADJUSTMENT"
  | "OPENING_BALANCE"
  | "REVERSAL"

/** Ligne du cahier. `amount` > 0 : le client doit plus ; < 0 : il doit moins. */
export type LedgerEntry = {
  id: string
  entry_type: LedgerEntryType
  label: string
  amount: string
  /** Solde juste après cette ligne. */
  running_balance: string
  occurred_at: string
  sale_id: string | null
  sale_return_id: string | null
  customer_payment: { id: string; reference: string; method: PaymentMethod } | null
  reference: string
  reason: string
  created_by: string | null
}

/** Fiche client : le client, son solde et tout son cahier, du plus récent au plus ancien. */
export type CustomerDetail = Customer & { entries: LedgerEntry[] }

/** Remboursement d'un client, avec l'instantané du solde pour le reçu. */
export type CustomerPayment = {
  id: string
  reference: string
  customer: SaleCustomer
  store: { id: string; name: string }
  cash_register: { id: string; name: string }
  cash_session_id: string
  method: PaymentMethod
  amount: string
  received_amount: string | null
  change_amount: string | null
  balance_before: string
  balance_after: string
  created_by: string
  created_at: string
}

/** Client d'une vente mise au cahier, tel que la vente le référence. */
export type SaleCustomer = {
  id: string
  name: string
  phone: string | null
}

export type SaleResponse = {
  id: string
  status: "COMPLETED" | "CANCELLED"
  subtotal: string
  discount: string
  total: string
  returned_total?: string
  net_total?: string
  // Un seul élément dans l'immense majorité des ventes — plusieurs pour un
  // paiement mixte (espèces + Wave, par exemple).
  payments: Array<{
    method: PaymentMethod
    amount: string
    received_amount: string | null
    change_amount: string | null
  }>
  /** Part non encaissée, inscrite au cahier du client ("0.00" sinon). */
  credit_amount?: string
  /** Ce qu'un retour effacerait encore du cahier avant de rendre de l'argent (détail de vente). */
  credit_reducible?: string
  customer?: SaleCustomer | null
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

export type SaleSummary = Pick<
  SaleReceipt,
  | "id"
  | "created_at"
  | "store"
  | "cash_register"
  | "cashier"
  | "status"
  | "total"
  | "returned_total"
  | "net_total"
  | "payments"
  | "credit_amount"
  | "customer"
>

export type PaginatedSales = {
  count: number
  next: string | null
  previous: string | null
  results: SaleSummary[]
}

export type SaleReturn = {
  id: string
  reference: string
  original_sale_id: string
  /** Valeur des articles rendus. */
  total_refund: string
  /** Part effacée du cahier du client, sans argent rendu. */
  credit_reduction?: string
  /** Argent réellement rendu : `total_refund − credit_reduction`. */
  money_refund?: string
  /** Null quand tout le retour a été déduit du cahier. */
  payment_method: PaymentMethod | null
  status: "COMPLETED"
  created_at: string
  items: Array<{ id: string; product_name: string; sale_unit: "UNIT" | "KG"; quantity: string; unit_price: string; refund_amount: string; restock: boolean }>
}

export type ExpenseCategory = {
  id: string
  name: string
  /** La catégorie seule ne dit pas ce qui a été payé (« Autre »…). */
  requires_description: boolean
}

export type ExpenseStatus = "POSTED" | "CANCELLED"

export type Expense = {
  id: string
  reference: string
  category: ExpenseCategory
  amount: string
  payment_method: PaymentMethod
  description: string
  document_reference: string
  status: ExpenseStatus
  store: { id: string; name: string }
  cash_register: { id: string; name: string } | null
  cash_session_id: string | null
  occurred_at: string
  created_by: string
  cancelled_at: string | null
  cancelled_by: string | null
  cancellation_reason: string
  /** Même règle que le serveur : l'annulation réussira si on la tente. */
  can_cancel: boolean
}

/** Totaux du filtre courant, dépenses annulées exclues. */
export type ExpenseTotals = {
  count: number
  total: string
  cash: string
  wave: string
  orange_money: string
}

export type PaginatedExpenses = {
  count: number
  next: string | null
  previous: string | null
  results: Expense[]
  totals: ExpenseTotals
}
