import { useEffect, useRef, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom"

import { logout } from "../../api/auth"
import { API_BASE_URL } from "../../api/client"
import { resetAnalytics } from "../../analytics/posthog"
import { clearSentryUser } from "../../analytics/sentry"
import { CashRegisterIcon, ChevronDownIcon, LogOutIcon, PowerIcon, ReceiptIcon, SettingsIcon, UsersIcon } from "../ui/Icons"
import { LogoMark } from "../ui/Logo"
import { ToastProvider, useToast } from "../ui/Toast"
import { CashContextLabel } from "../../features/cash-session/CashContextLabel"
import { SessionMenuStats } from "../../features/cash-session/SessionStatsLabel"
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
  const fullName = [user.first_name, user.last_name].filter(Boolean).join(" ") || user.username
  const initials = (
    user.first_name && user.last_name
      ? `${user.first_name[0]}${user.last_name[0]}`
      : userName.slice(0, 2)
  ).toUpperCase()
  const showCashSessionActions =
    location.pathname === "/pos" ||
    location.pathname === "/cash/close" ||
    location.pathname.startsWith("/sales") ||
    location.pathname.startsWith("/returns") ||
    location.pathname.startsWith("/customers")
  const isCashRoute =
    location.pathname === "/pos" ||
    location.pathname.startsWith("/cash")
  const isSalesRoute =
    location.pathname.startsWith("/sales") ||
    location.pathname.startsWith("/returns")
  const isCustomersRoute =
    location.pathname.startsWith("/customers") ||
    location.pathname.startsWith("/customer-payments")
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
        {/* Le symbole occupe la colonne de la barre latérale, centré comme
            ses icônes : en-tête et navigation forment un seul chrome. Le
            contexte démarre ensuite au bord du contenu. */}
        <div className="app-header-status">
          <Link className="brand-link" to="/" aria-label="LoPOS — Accueil">
            <LogoMark size={34} />
          </Link>
          <CashContextLabel />
        </div>
        <div className="app-header-right">
          <ConnectionStatus />
          <div ref={sessionMenuRef} className="user-menu">
            <button
              ref={sessionMenuButtonRef}
              className="session-menu-trigger"
              type="button"
              aria-expanded={isSessionMenuOpen}
              aria-controls="session-menu-panel"
              aria-label={`Menu de session — ${userName}`}
              onClick={() => setIsSessionMenuOpen((isOpen) => !isOpen)}
            >
              <span className="session-menu-avatar" aria-hidden="true">{initials}</span>
              <ChevronDownIcon className="session-menu-chevron" />
            </button>
            {isSessionMenuOpen ? (
              <div id="session-menu-panel" className="session-menu-panel" aria-label="Actions de session">
                {/* Le nom vit ici, pas dans l'en-tête : les initiales suffisent
                    à reconnaître sa session, le détail vient au clic. */}
                <div className="session-menu-identity">
                  <strong>{fullName}</strong>
                  {fullName !== user.username ? <span>{user.username}</span> : null}
                </div>
                <SessionMenuStats />
                {/* Sur grand écran la clôture est déjà dans la barre latérale :
                    l'entrée du menu ne sert qu'en barre basse, où elle est
                    masquée. Voir .session-menu-close. */}
                {showCashSessionActions ? (
                  <>
                    <Link className="session-menu-item session-menu-close" to="/cash/close" onClick={() => setIsSessionMenuOpen(false)}>
                      <PowerIcon />
                      <span>Clôturer la caisse</span>
                    </Link>
                    <div className="session-menu-separator session-menu-close" />
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
          <Link
            className={`app-navigation-link${isCustomersRoute ? " app-navigation-link-active" : ""}`}
            to="/customers"
            title="Cahier clients"
            aria-current={isCustomersRoute ? "page" : undefined}
          >
            <UsersIcon />
            <span>Clients</span>
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
