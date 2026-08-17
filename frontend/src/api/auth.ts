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

export function logout(): Promise<DetailResponse> {
  return apiRequest<DetailResponse>("auth/logout/", {
    method: "POST",
    body: {},
  })
}
