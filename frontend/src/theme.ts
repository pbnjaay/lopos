/**
 * Thème du poste : clair par défaut, sombre ou « Système » au choix du
 * caissier. Le choix est propre à chaque poste (localStorage), comme la
 * caisse sélectionnée. Le thème résolu est posé sur <html data-theme>, que
 * styles.css lit. Le script inline d'index.html applique le même choix avant
 * le premier rendu : toute retouche de la clé ou des couleurs se fait aux
 * deux endroits.
 */
export type ThemePreference = "system" | "light" | "dark"
type ResolvedTheme = "light" | "dark"

export const THEME_PREFERENCE_KEY = "lopos.theme"

// Barre de statut de la PWA : le vert de marque en clair, le chrome en sombre.
const THEME_COLORS: Record<ResolvedTheme, string> = {
  light: "#176b4d",
  dark: "#121a16",
}

const DARK_QUERY = "(prefers-color-scheme: dark)"

export function getThemePreference(): ThemePreference {
  try {
    const value = localStorage.getItem(THEME_PREFERENCE_KEY)
    return value === "system" || value === "dark" ? value : "light"
  } catch {
    return "light"
  }
}

function systemPrefersDark(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(DARK_QUERY).matches
}

function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference === "system") return systemPrefersDark() ? "dark" : "light"
  return preference
}

export function applyTheme(preference: ThemePreference): void {
  const theme = resolveTheme(preference)
  document.documentElement.dataset.theme = theme
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLORS[theme])
}

export function setThemePreference(preference: ThemePreference): void {
  try {
    localStorage.setItem(THEME_PREFERENCE_KEY, preference)
  } catch {
    // localStorage indisponible (navigation privée) : le thème vaut pour la session.
  }
  applyTheme(preference)
}

/** À appeler une fois au démarrage : suit le système quand « Système » est choisi. */
export function initTheme(): void {
  applyTheme(getThemePreference())
  if (typeof window.matchMedia !== "function") return
  window.matchMedia(DARK_QUERY).addEventListener("change", () => {
    if (getThemePreference() === "system") applyTheme("system")
  })
}
