import type { CurrentUser } from "../types/api"
import { ApiError, apiRequest } from "./client"

export type LoginInput = {
  username: string
  password: string
}

type DetailResponse = {
  detail: string
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  try {
    return await apiRequest<CurrentUser>("auth/me/")
  } catch (error) {
    if (error instanceof ApiError && [401, 403].includes(error.status)) return null
    throw error
  }
}

export async function login(input: LoginInput): Promise<CurrentUser> {
  await apiRequest<DetailResponse>("auth/csrf/")
  return apiRequest<CurrentUser>("auth/login/", {
    method: "POST",
    body: input,
  })
}

export async function logout(): Promise<DetailResponse> {
  // Le cookie CSRF déjà posé (login, ou une visite antérieure) peut avoir
  // expiré ou disparu sans que rien d'autre côté front ne le renouvelle —
  // sans ce fetch, la déconnexion échoue en CSRF et personne ne peut se
  // reconnecter avec un autre compte. Même garantie qu'au login.
  await apiRequest<DetailResponse>("auth/csrf/")
  return apiRequest<DetailResponse>("auth/logout/", {
    method: "POST",
    body: {},
  })
}
