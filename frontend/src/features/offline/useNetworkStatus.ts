import { useEffect, useState } from "react"

import {
  API_AVAILABLE_EVENT,
  API_UNAVAILABLE_EVENT,
  isNavigatorOnline,
} from "../../utils/network"

export { API_AVAILABLE_EVENT, API_UNAVAILABLE_EVENT } from "../../utils/network"

export function useNetworkStatus(): boolean {
  const [isOnline, setIsOnline] = useState(isNavigatorOnline)

  useEffect(() => {
    function handleOnline() {
      setIsOnline(true)
    }
    function handleOffline() {
      setIsOnline(false)
    }
    function handleApiUnavailable() {
      setIsOnline(false)
    }
    function handleApiAvailable() {
      if (isNavigatorOnline()) setIsOnline(true)
    }

    window.addEventListener("online", handleOnline)
    window.addEventListener("offline", handleOffline)
    window.addEventListener(API_UNAVAILABLE_EVENT, handleApiUnavailable)
    window.addEventListener(API_AVAILABLE_EVENT, handleApiAvailable)
    return () => {
      window.removeEventListener("online", handleOnline)
      window.removeEventListener("offline", handleOffline)
      window.removeEventListener(API_UNAVAILABLE_EVENT, handleApiUnavailable)
      window.removeEventListener(API_AVAILABLE_EVENT, handleApiAvailable)
    }
  }, [])

  return isOnline
}
