export function isNavigatorOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine
}
