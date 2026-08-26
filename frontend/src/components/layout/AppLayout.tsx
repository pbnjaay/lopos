import { useEffect, useRef, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom"

import { logout } from "../../api/auth"
import { API_BASE_URL } from "../../api/client"
import { resetAnalytics } from "../../analytics/posthog"
import { clearSentryUser } from "../../analytics/sentry"
import { CashRegisterIcon, ChevronDownIcon, LogOutIcon, PowerIcon, ReceiptIcon, SettingsIcon, UserIcon } from "../ui/Icons"
import { ToastProvider, useToast } from "../ui/Toast"
import { ConnectionStatus, NetworkNotifications } from "../../features/offline/OfflineBanner"
import type { CurrentUser } from "../../types/api"
import { describeErrorShort } from "../../utils/errorCopy"

type AppLayoutProps = {
  user: CurrentUser
}

const ADMIN_URL = /^https?:\/\//.test(API_BASE_URL)
  ? new URL("/admin/", API_BASE_URL).toString()
  : "http://localhost:8000/admin/"

export function AppLayout({ user }: AppLayoutProps) {
  return (
    <ToastProvider>
      <AppShell user={user} />
    </ToastProvider>
  )
}

function AppShell({ user }: AppLayoutProps) {
  const navigate = useNavigate()
  const toast = useToast()
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
  const isCashRoute =
    location.pathname === "/pos" ||
    location.pathname.startsWith("/cash")
  const isSalesRoute =
    location.pathname.startsWith("/sales") ||
    location.pathname.startsWith("/returns")
  const logoutMutation = useMutation({
    mutationFn: logout,
    onError: (error) => {
      // Une déconnexion qui échoue n'empêche pas de vendre : un toast, pas
      // un bandeau rouge en travers de l'application.
      toast.error("Déconnexion impossible", { description: describeErrorShort(error, "session") })
    },
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
        </div>
        <div className="app-header-right">
          <ConnectionStatus />
          <span className="app-header-divider" aria-hidden="true" />
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
                    <Link className="session-menu-item" to="/cash/close" onClick={() => setIsSessionMenuOpen(false)}>
                      <PowerIcon />
                      <span>Clôturer la caisse</span>
                    </Link>
                    <div className="session-menu-separator" />
                  </>
                ) : null}
                {user.is_staff ? (
                  <>
                    <a
                      className="session-menu-item"
                      href={ADMIN_URL}
                      target="_blank"
                      rel="noreferrer"
                      onClick={() => setIsSessionMenuOpen(false)}
                    >
                      <SettingsIcon />
                      <span>Administration</span>
                    </a>
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
        </div>
      </header>
      <NetworkNotifications />
      <div className="app-frame">
        <nav className="app-navigation" aria-label="Navigation principale">
          <Link
            className={`app-navigation-link${isCashRoute ? " app-navigation-link-active" : ""}`}
            to="/"
            title="Caisse"
            aria-current={isCashRoute ? "page" : undefined}
          >
            <CashRegisterIcon />
            <span>Caisse</span>
          </Link>
          <Link
            className={`app-navigation-link${isSalesRoute ? " app-navigation-link-active" : ""}`}
            to="/sales"
            title="Ventes"
            aria-current={isSalesRoute ? "page" : undefined}
          >
            <ReceiptIcon />
            <span>Ventes</span>
          </Link>
          {showCashSessionActions ? (
            <Link
              className="app-navigation-link app-navigation-session-action"
              to="/cash/close"
              title="Clôturer la caisse"
            >
              <PowerIcon />
              <span>Clôturer</span>
            </Link>
          ) : null}
        </nav>
        <div className="app-content">
          <Outlet />
        </div>
      </div>
    </div>
  )
}
