export const API_UNAVAILABLE_EVENT = "lopos:api-unavailable"
export const API_AVAILABLE_EVENT = "lopos:api-available"

export function isNavigatorOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine
}
