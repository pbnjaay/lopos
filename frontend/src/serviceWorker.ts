export function registerOfflineServiceWorker(): void {
  if (!("serviceWorker" in navigator)) return

  const register = () => {
    void navigator.serviceWorker.register("/sw.js", { scope: "/" })
  }

  if (document.readyState === "complete") {
    register()
  } else {
    window.addEventListener("load", register, { once: true })
  }
}
