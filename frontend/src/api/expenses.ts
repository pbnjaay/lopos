import type {
  Expense,
  ExpenseCategory,
  ExpenseStatus,
  PaginatedExpenses,
  PaymentMethod,
} from "../types/api"
import { apiRequest, buildApiUrl } from "./client"

/** Catégories actives, dans l'ordre choisi par le gérant. */
export function listExpenseCategories(): Promise<ExpenseCategory[]> {
  return apiRequest<ExpenseCategory[]>("expense-categories/")
}

/**
 * Nouvelle dépense (en ligne uniquement), dans la session ouverte du
 * caissier. `idempotencyKey` est généré une fois par tentative : renvoyer la
 * même requête après une coupure ne crée jamais une seconde dépense.
 */
export function createExpense(input: {
  idempotencyKey: string
  cashSessionId: string
  categoryId: string
  paymentMethod: PaymentMethod
  amount: string
  description: string
  documentReference: string
}): Promise<Expense> {
  return apiRequest<Expense>("expenses/", {
    method: "POST",
    body: {
      idempotency_key: input.idempotencyKey,
      cash_session_id: input.cashSessionId,
      category_id: input.categoryId,
      payment_method: input.paymentMethod,
      amount: input.amount,
      description: input.description,
      document_reference: input.documentReference,
    },
  })
}

/** Dépenses de la boutique de la session, du plus récent au plus ancien. */
export function listExpenses(input: {
  cashSessionId: string
  dateFrom?: string
  dateTo?: string
  categoryId?: string
  paymentMethod?: PaymentMethod | ""
  status?: ExpenseStatus | ""
  page?: number
  pageSize?: number
}): Promise<PaginatedExpenses> {
  return apiRequest<PaginatedExpenses>(buildApiUrl("expenses/", {
    cash_session_id: input.cashSessionId,
    date_from: input.dateFrom || undefined,
    date_to: input.dateTo || undefined,
    category_id: input.categoryId || undefined,
    payment_method: input.paymentMethod || undefined,
    status: input.status || undefined,
    page: input.page,
    page_size: input.pageSize,
  }))
}

export function getExpense(expenseId: string): Promise<Expense> {
  return apiRequest<Expense>(`expenses/${encodeURIComponent(expenseId)}/`)
}

export function cancelExpense(expenseId: string, reason: string): Promise<Expense> {
  return apiRequest<Expense>(`expenses/${encodeURIComponent(expenseId)}/cancel/`, {
    method: "POST",
    body: { reason },
  })
}
