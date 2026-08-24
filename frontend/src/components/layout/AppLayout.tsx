import { useEffect, useRef, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom"

import { logout } from "../../api/auth"
import { resetAnalytics } from "../../analytics/posthog"
import { clearSentryUser } from "../../analytics/sentry"
import { ChevronDownIcon, LogOutIcon, PowerIcon, ReceiptIcon, UserIcon } from "../ui/Icons"
import { ConnectionStatus } from "../../features/offline/OfflineBanner"
import type { CurrentUser } from "../../types/api"

type AppLayoutProps = {
  user: CurrentUser
}

export function AppLayout({ user }: AppLayoutProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const [isSessionMenuOpen, setIsSessionMenuOpen] = useState(false)
  const sessionMenuRef = useRef<HTMLDivElement>(null)
  const sessionMenuButtonRef = useRef<HTMLButtonElement>(null)
  const userName = user.first_name || user.username
  const showCashSessionActions =
    location.pathname === "/pos" ||
    location.pathname === "/cash/close" ||
    location.pathname.startsWith("/sales") ||
    location.pathname.startsWith("/returns")
  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: () => {
      queryClient.clear()
      resetAnalytics()
      clearSentryUser()
      navigate("/login", { replace: true })
    },
  })

  useEffect(() => {
    if (!isSessionMenuOpen) return

    function handlePointerDown(event: PointerEvent) {
      if (!sessionMenuRef.current?.contains(event.target as Node)) {
        setIsSessionMenuOpen(false)
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return
      setIsSessionMenuOpen(false)
      sessionMenuButtonRef.current?.focus()
    }

    document.addEventListener("pointerdown", handlePointerDown)
    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [isSessionMenuOpen])

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-status">
          <Link className="brand brand-link" to="/" aria-label="LoPOS — Accueil">LoPOS</Link>
          <ConnectionStatus />
        </div>
        <div ref={sessionMenuRef} className="user-menu">
          <button
            ref={sessionMenuButtonRef}
            className="session-menu-trigger"
            type="button"
            aria-expanded={isSessionMenuOpen}
            aria-controls="session-menu-panel"
            aria-haspopup="true"
            aria-label={`Menu de session — ${userName}`}
            onClick={() => setIsSessionMenuOpen((isOpen) => !isOpen)}
          >
            <UserIcon className="session-menu-user-icon" />
            <span className="header-user-name">{userName}</span>
            <ChevronDownIcon className="session-menu-chevron" />
          </button>
          {isSessionMenuOpen ? (
            <div id="session-menu-panel" className="session-menu-panel" aria-label="Actions de session">
              {showCashSessionActions ? (
                <>
                  <Link className="session-menu-item" to="/sales" onClick={() => setIsSessionMenuOpen(false)}>
                    <ReceiptIcon />
                    <span>Ventes</span>
                  </Link>
                  <Link className="session-menu-item" to="/cash/close" onClick={() => setIsSessionMenuOpen(false)}>
                    <PowerIcon />
                    <span>Clôturer la caisse</span>
                  </Link>
                  <div className="session-menu-separator" />
                </>
              ) : null}
              <button
                className="session-menu-item session-menu-logout"
                type="button"
                disabled={logoutMutation.isPending}
                onClick={() => {
                  setIsSessionMenuOpen(false)
                  logoutMutation.mutate()
                }}
              >
                <LogOutIcon />
                <span>{logoutMutation.isPending ? "Déconnexion…" : "Se déconnecter"}</span>
              </button>
            </div>
          ) : null}
        </div>
      </header>
      {logoutMutation.error ? (
        <p className="global-error" role="alert">
          {logoutMutation.error.message}
        </p>
      ) : null}
      <Outlet />
    </div>
  )
}
