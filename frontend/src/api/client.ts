const configuredBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim()

export const API_BASE_URL = (configuredBaseUrl || "/api/v1").replace(/\/+$/, "")

/**
 * `navigator.onLine` only reflects whether a network interface is up, not
 * whether the server is actually reachable — a request can hang far longer
 * than any reasonable UI should wait (dropped packets, a captive portal, a
 * VPN gone stale, or a browser devtools "offline" throttle, which does not
 * update navigator.onLine and can leave a request pending instead of
 * failing it outright). Bound every request so a "looks online but isn't"
 * state fails into a NetworkError within a few seconds instead of leaving
 * the cashier staring at a frozen payment screen.
 */
const REQUEST_TIMEOUT_MS = 5_000

export type ApiErrorBody = {
  code?: string
  message?: string
  detail?: string
  [field: string]: unknown
}

export class ApiError extends Error {
  readonly status: number
  readonly code?: string
  readonly body: ApiErrorBody | null

  constructor(status: number, body: ApiErrorBody | null) {
    super(getErrorMessage(status, body))
    this.name = "ApiError"
    this.status = status
    this.code = body?.code
    this.body = body
  }
}

export class NetworkError extends Error {
  constructor() {
    super("Impossible de joindre le serveur. Vérifiez votre connexion Internet.")
    this.name = "NetworkError"
  }
}

export function isApiUnavailable(error: unknown): boolean {
  return error instanceof NetworkError || (error instanceof ApiError && error.status >= 500)
}

type ApiRequestOptions = Omit<RequestInit, "body"> & {
  body?: unknown
}

function getCookie(name: string): string | undefined {
  const cookie = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))

  return cookie ? decodeURIComponent(cookie.slice(name.length + 1)) : undefined
}

/**
 * Cross-domain deployments (Vercel frontend + Railway backend) can't read
 * the `csrftoken` cookie via `document.cookie` — it belongs to a different
 * registrable domain, and no CORS/SameSite setting changes that. The
 * backend mirrors the token onto an `X-CSRFToken` response header instead
 * (see `ExposeCsrfTokenMiddleware`); cache it here and fall back to it
 * whenever the cookie itself isn't readable.
 */
let cachedCsrfToken: string | undefined

function getCsrfToken(): string | undefined {
  return getCookie("csrftoken") ?? cachedCsrfToken
}

function isUnsafeMethod(method: string): boolean {
  return !["GET", "HEAD", "OPTIONS", "TRACE"].includes(method.toUpperCase())
}

function getErrorMessage(status: number, body: ApiErrorBody | null): string {
  if (body?.message) return body.message
  if (body?.detail) return body.detail
  const validationMessage = getValidationMessage(body)
  if (validationMessage) return validationMessage
  if (status >= 500) return "Le serveur a rencontré une erreur."
  return `La requête a échoué (${status}).`
}

function getValidationMessage(value: unknown): string | null {
  if (typeof value === "string") return value
  if (Array.isArray(value)) {
    for (const item of value) {
      const message = getValidationMessage(item)
      if (message) return message
    }
  }
  if (typeof value === "object" && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      if (key === "code") continue
      const message = getValidationMessage(item)
      if (message) return message
    }
  }
  return null
}

async function readResponseBody(response: Response): Promise<unknown> {
  if (response.status === 204) return null

  const contentType = response.headers.get("content-type") ?? ""
  if (contentType.includes("application/json")) return response.json()

  const text = await response.text()
  return text ? { detail: text } : null
}

function toApiErrorBody(value: unknown): ApiErrorBody | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null
  }
  return value as ApiErrorBody
}

export function buildApiUrl(
  path: string,
  query?: Record<string, string | number | undefined>,
): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`
  const url = `${API_BASE_URL}${normalizedPath}`
  const searchParams = new URLSearchParams()

  Object.entries(query ?? {}).forEach(([key, value]) => {
    if (value !== undefined) searchParams.set(key, String(value))
  })

  const search = searchParams.toString()
  return search ? `${url}?${search}` : url
}

function isAbsoluteApiPath(path: string): boolean {
  return path === API_BASE_URL || path.startsWith(`${API_BASE_URL}/`)
}

export async function apiRequest<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const method = options.method ?? "GET"
  const headers = new Headers(options.headers)
  headers.set("Accept", "application/json")

  let body: BodyInit | undefined
  if (options.body !== undefined) {
    headers.set("Content-Type", "application/json")
    body = JSON.stringify(options.body)
  }

  if (isUnsafeMethod(method)) {
    const csrfToken = getCsrfToken()
    if (csrfToken) headers.set("X-CSRFToken", csrfToken)
  }

  const timeoutController = new AbortController()
  const timeoutId = setTimeout(() => timeoutController.abort(), REQUEST_TIMEOUT_MS)

  let response: Response
  try {
    response = await fetch(isAbsoluteApiPath(path) ? path : buildApiUrl(path), {
      ...options,
      method,
      headers,
      body,
      credentials: "include",
      signal: options.signal ?? timeoutController.signal,
    })
  } catch {
    throw new NetworkError()
  } finally {
    clearTimeout(timeoutId)
  }

  const refreshedCsrfToken = response.headers.get("X-CSRFToken")
  if (refreshedCsrfToken) cachedCsrfToken = refreshedCsrfToken

  const responseBody = await readResponseBody(response)
  if (!response.ok) {
    throw new ApiError(response.status, toApiErrorBody(responseBody))
  }

  return responseBody as T
}
